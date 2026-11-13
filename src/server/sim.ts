// Authoritative match simulation: movement validation, hitscan with lag
// compensation, three-loop timeline recording/replay, paradox resolution,
// capture-point scoring and round/match flow.
//
// This module is pure TypeScript with no networking so it can be unit-tested
// deterministically; DuelRoom mirrors its state into Colyseus schema.

import {
  ANOMALY,
  CAPTURE_MULT,
  CAPTURE_RATE,
  COUNTDOWN_DURATION,
  FIRE_INTERVAL,
  LOOP_DURATION,
  LOOPS_PER_ROUND,
  MAX_HP,
  MAX_REWIND_MS,
  MAX_TRACKS_PER_LOOP,
  METER_MAX,
  POINT_RADIUS,
  RESPAWN_DELAY,
  REWIND_DURATION,
  RIFLE,
  ROUND_END_DURATION,
  ROUNDS_TO_WIN,
  SPAWN_PROTECTION,
  TICK_DT,
  type Phase,
  type Side,
  type UnitKind,
} from "../shared/constants";
import { SPAWNS } from "../shared/map";
import {
  angleBetween,
  dirFromAngles,
  eyeOf,
  hasLineOfSight,
  isSprinting,
  newMoveState,
  raycastWorld,
  rayCharacter,
  stepMove,
  type HitboxPose,
  type MoveState,
  type Vec3,
} from "../shared/physics";
import type { FireMsg, InputMsg, ParadoxType, ServerEvent } from "../shared/protocol";

export interface Frame {
  t: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  c: boolean;
  a: boolean;
  s: number;
}

export interface ShotRec {
  t: number;
  dx: number;
  dy: number;
  dz: number;
  /** Unit originally hit (null = miss / geometry). */
  target: string | null;
  dist: number;
  head: boolean;
  dmg: number;
}

export type EndReason = "loopEnd" | "death" | "disconnect";

export interface Track {
  id: string;
  side: Side;
  ownerId: string;
  ownerName: string;
  loop: number;
  startT: number;
  endT: number;
  endReason: EndReason | null;
  frames: Frame[];
  shots: ShotRec[];
}

export interface AnomalyAI {
  targetId: string | null;
  seenFor: number;
  burstLeft: number;
  nextShot: number;
}

export interface SimUnit {
  id: string;
  side: Side;
  kind: UnitKind;
  ownerId: string;
  ownerName: string;
  loop: number;
  move: MoveState;
  yaw: number;
  pitch: number;
  ads: boolean;
  sprint: boolean;
  speed: number;
  hp: number;
  protUntil: number;
  track: Track;
  frameIdx: number;
  shotIdx: number;
  ai: AnomalyAI | null;
}

export interface SimPlayer {
  id: string;
  name: string;
  side: Side;
  ready: boolean;
  connected: boolean;
  unitId: string | null;
  respawnAt: number | null;
  ammo: number;
  reloadEnd: number;
  lastFire: number;
  kills: number;
  deaths: number;
  erased: number;
  rescued: number;
  budget: number;
  /** token bucket for rate of fire (tolerates network jitter bunching) */
  fireTokens: number;
  lastSeq: number;
  ping: number;
  tracksThisLoop: number;
}

interface HistoryEntry {
  time: number;
  poses: Map<string, HitboxPose>;
}

export interface TraceResult {
  dist: number;
  normal: [number, number, number] | null;
  unit: SimUnit | null;
  head: boolean;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const wrapAngle = (a: number) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};
const MAX_SPREAD_CHECK = RIFLE.hipSpread + RIFLE.moveSpreadAdd + RIFLE.airSpreadAdd + 0.06;

export class MatchSim {
  phase: Phase = "lobby";
  phaseLeft = 0;
  round = 0;
  loop = 0;
  loopTime = 0;
  meter = 0;
  /** -1 none, 0/1 side capturing, 2 contested */
  capture = -1;
  roundWins: [number, number] = [0, 0];
  lastRoundWinner = -1;
  matchWinner = -1;
  endReason = "";
  paused = false;
  /** Monotonic simulation clock (s), frozen while paused. */
  time = 0;

  players = new Map<string, SimPlayer>();
  units = new Map<string, SimUnit>();
  tracks: Track[] = [];
  events: ServerEvent[] = [];

  private history: HistoryEntry[] = [];
  private pendingClones: Track[] = [];
  private rng: () => number;

  constructor(rng: () => number = Math.random) {
    this.rng = rng;
  }

  // ---------------------------------------------------------------- players
  addPlayer(id: string, name: string): SimPlayer | null {
    if (this.players.size >= 2) return null;
    const taken = new Set([...this.players.values()].map((p) => p.side));
    const side: Side = taken.has(0) ? 1 : 0;
    const p: SimPlayer = {
      id,
      name: sanitizeName(name),
      side,
      ready: false,
      connected: true,
      unitId: null,
      respawnAt: null,
      ammo: RIFLE.magSize,
      reloadEnd: 0,
      lastFire: -10,
      kills: 0,
      deaths: 0,
      erased: 0,
      rescued: 0,
      budget: 0.2,
      fireTokens: 1,
      lastSeq: 0,
      ping: 0,
      tracksThisLoop: 0,
    };
    this.players.set(id, p);
    return p;
  }

  removePlayer(id: string) {
    this.players.delete(id);
  }

  get inMatch() {
    return this.phase === "countdown" || this.phase === "loop" || this.phase === "rewind" || this.phase === "roundEnd";
  }

  setReady(id: string, ready: boolean) {
    const p = this.players.get(id);
    if (!p) return;
    if (this.phase !== "lobby" && this.phase !== "matchEnd") return;
    p.ready = ready;
    if (this.players.size === 2 && [...this.players.values()].every((q) => q.ready && q.connected)) this.startMatch();
  }

  setConnected(id: string, connected: boolean) {
    const p = this.players.get(id);
    if (!p) return;
    p.connected = connected;
    if (!connected) p.ready = false;
    this.paused = this.inMatch && [...this.players.values()].some((q) => !q.connected);
  }

  forfeit(id: string) {
    const p = this.players.get(id);
    if (!p) return;
    if (this.inMatch) {
      const winner = (1 - p.side) as Side;
      this.matchWinner = winner;
      this.endReason = "forfeit";
      this.phase = "matchEnd";
      this.paused = false;
      for (const q of this.players.values()) q.ready = false;
      this.emit({ type: "phase", data: { phase: "matchEnd", round: this.round, loop: this.loop, winner } });
    }
  }

  // ---------------------------------------------------------------- flow
  startMatch() {
    this.roundWins = [0, 0];
    this.round = 0;
    this.matchWinner = -1;
    this.lastRoundWinner = -1;
    this.endReason = "";
    for (const p of this.players.values()) {
      p.kills = p.deaths = p.erased = p.rescued = 0;
      p.ready = false;
    }
    this.startRound();
  }

  private startRound() {
    this.round++;
    this.loop = 1;
    this.meter = 0;
    this.capture = -1;
    this.tracks = [];
    this.setupLoop();
    this.phase = "countdown";
    this.phaseLeft = COUNTDOWN_DURATION;
    this.emit({ type: "phase", data: { phase: "countdown", round: this.round, loop: this.loop } });
  }

  private setupLoop() {
    this.units.clear();
    this.history = [];
    this.loopTime = 0;
    this.pendingClones = this.tracks.filter((t) => t.loop < this.loop).sort((a, b) => a.startT - b.startT);
    for (const p of this.players.values()) {
      p.ammo = RIFLE.magSize;
      p.reloadEnd = 0;
      p.respawnAt = null;
      p.tracksThisLoop = 0;
      p.unitId = null;
      const sp = SPAWNS[p.side][(this.loop - 1) % SPAWNS[p.side].length];
      this.spawnLive(p, sp.x, sp.y, sp.z, sp.yaw);
    }
    this.spawnDueClones();
  }

  private spawnLive(p: SimPlayer, x: number, y: number, z: number, yaw: number) {
    const id = `R${this.round}L${this.loop}${p.side === 0 ? "C" : "E"}${p.tracksThisLoop}`;
    p.tracksThisLoop++;
    const track: Track = {
      id,
      side: p.side,
      ownerId: p.id,
      ownerName: p.name,
      loop: this.loop,
      startT: this.loopTime,
      endT: LOOP_DURATION,
      endReason: null,
      frames: [],
      shots: [],
    };
    this.tracks.push(track);
    const u: SimUnit = {
      id,
      side: p.side,
      kind: "live",
      ownerId: p.id,
      ownerName: p.name,
      loop: this.loop,
      move: newMoveState(x, y, z),
      yaw,
      pitch: 0,
      ads: false,
      sprint: false,
      speed: 0,
      hp: MAX_HP,
      protUntil: this.loopTime + SPAWN_PROTECTION,
      track,
      frameIdx: 0,
      shotIdx: 0,
      ai: null,
    };
    this.units.set(id, u);
    p.unitId = id;
    p.respawnAt = null;
    this.recordFrame(u);
  }

  private spawnDueClones() {
    while (this.pendingClones.length && this.pendingClones[0].startT <= this.loopTime + 1e-9) {
      const tr = this.pendingClones.shift()!;
      if (!tr.frames.length) continue;
      const f = tr.frames[0];
      const u: SimUnit = {
        id: tr.id,
        side: tr.side,
        kind: "clone",
        ownerId: tr.ownerId,
        ownerName: tr.ownerName,
        loop: tr.loop,
        move: newMoveState(f.x, f.y, f.z),
        yaw: f.yaw,
        pitch: f.pitch,
        ads: f.a,
        sprint: false,
        speed: f.s,
        hp: MAX_HP,
        protUntil: 0,
        track: tr,
        frameIdx: 0,
        shotIdx: 0,
        ai: null,
      };
      u.move.crouching = f.c;
      this.units.set(u.id, u);
    }
  }

  update(dt: number = TICK_DT) {
    if (this.phase === "lobby" || this.phase === "matchEnd" || this.paused) return;
    this.time += dt;
    for (const p of this.players.values()) {
      p.budget = Math.min(p.budget + dt, 0.3);
      p.fireTokens = Math.min(2, p.fireTokens + dt / FIRE_INTERVAL);
    }

    switch (this.phase) {
      case "countdown":
        this.phaseLeft -= dt;
        if (this.phaseLeft <= 0) {
          this.phase = "loop";
          this.phaseLeft = LOOP_DURATION;
          this.emit({ type: "phase", data: { phase: "loop", round: this.round, loop: this.loop } });
        }
        break;
      case "loop":
        this.stepLoop(dt);
        break;
      case "rewind":
        this.phaseLeft -= dt;
        if (this.phaseLeft <= 0) {
          this.loop++;
          this.setupLoop();
          this.phase = "loop";
          this.phaseLeft = LOOP_DURATION;
          this.emit({ type: "phase", data: { phase: "loop", round: this.round, loop: this.loop } });
        }
        break;
      case "roundEnd":
        this.phaseLeft -= dt;
        if (this.phaseLeft <= 0) this.startRound();
        break;
    }
    this.pushHistory();
  }

  private stepLoop(dt: number) {
    this.loopTime = Math.min(LOOP_DURATION, this.loopTime + dt);
    this.phaseLeft = LOOP_DURATION - this.loopTime;

    for (const p of this.players.values()) {
      if (p.reloadEnd && this.time >= p.reloadEnd) {
        p.ammo = RIFLE.magSize;
        p.reloadEnd = 0;
      }
      if (p.respawnAt !== null && this.loopTime >= p.respawnAt) {
        const sp = this.pickRespawn(p.side);
        this.spawnLive(p, sp.x, sp.y, sp.z, sp.yaw);
        p.ammo = RIFLE.magSize;
        p.reloadEnd = 0;
      }
    }

    this.spawnDueClones();

    // Pass 1: replay clone motion and recorded shots.
    for (const u of [...this.units.values()]) {
      if (u.kind !== "clone") continue;
      this.replayPose(u);
      const shots = u.track.shots;
      while (u.shotIdx < shots.length && shots[u.shotIdx].t <= this.loopTime + 1e-9) {
        const s = shots[u.shotIdx++];
        if (u.kind !== "clone") break; // erased by an earlier shot this tick
        this.replayShot(u, s);
      }
    }
    // Pass 2: clones that outlived their recorded death become anomalies.
    for (const u of this.units.values()) {
      if (u.kind !== "clone") continue;
      const tr = u.track;
      if (tr.endReason && tr.endReason !== "loopEnd" && this.loopTime >= tr.endT) {
        u.kind = "anomaly";
        u.ai = { targetId: null, seenFor: 0, burstLeft: ANOMALY.burst, nextShot: 0 };
        u.speed = 0;
        u.ads = false;
        const owner = this.players.get(u.ownerId);
        if (owner) owner.rescued++;
        this.emitParadox("rescued", u);
      }
    }
    // Anomaly AI
    for (const u of [...this.units.values()]) if (u.kind === "anomaly") this.stepAnomaly(u, dt);

    // Record live tracks
    for (const u of this.units.values()) if (u.kind === "live") this.recordFrame(u);

    // Capture point
    let c0 = 0,
      c1 = 0;
    for (const u of this.units.values()) {
      if (u.kind === "ghost") continue;
      if (Math.hypot(u.move.x, u.move.z) <= POINT_RADIUS && u.move.y < 2.5) {
        if (u.side === 0) c0++;
        else c1++;
      }
    }
    const mult = (n: number) => CAPTURE_MULT[Math.min(n, CAPTURE_MULT.length - 1)];
    if (c0 > 0 && c1 === 0) {
      this.meter += CAPTURE_RATE * mult(c0) * dt;
      this.capture = 0;
    } else if (c1 > 0 && c0 === 0) {
      this.meter -= CAPTURE_RATE * mult(c1) * dt;
      this.capture = 1;
    } else this.capture = c0 > 0 && c1 > 0 ? 2 : -1;
    this.meter = clamp(this.meter, -METER_MAX, METER_MAX);
    if (this.meter >= METER_MAX) return this.endRound(0);
    if (this.meter <= -METER_MAX) return this.endRound(1);

    if (this.loopTime >= LOOP_DURATION - 1e-9) this.endLoop();
  }

  private endLoop() {
    for (const u of this.units.values()) {
      if (u.kind === "live") {
        u.track.endT = LOOP_DURATION;
        u.track.endReason = "loopEnd";
      }
    }
    if (this.loop < LOOPS_PER_ROUND) {
      this.phase = "rewind";
      this.phaseLeft = REWIND_DURATION;
      this.units.clear();
      for (const p of this.players.values()) {
        p.unitId = null;
        p.respawnAt = null;
      }
      this.emit({ type: "phase", data: { phase: "rewind", round: this.round, loop: this.loop } });
    } else {
      this.endRound(this.meter > 0 ? 0 : this.meter < 0 ? 1 : -1);
    }
  }

  private endRound(winner: number) {
    for (const u of this.units.values()) {
      if (u.kind === "live" && u.track.endReason === null) {
        u.track.endT = this.loopTime;
        u.track.endReason = "loopEnd";
      }
    }
    this.lastRoundWinner = winner;
    if (winner === 0 || winner === 1) this.roundWins[winner]++;
    for (const p of this.players.values()) p.respawnAt = null;
    if (winner >= 0 && this.roundWins[winner] >= ROUNDS_TO_WIN) {
      this.phase = "matchEnd";
      this.matchWinner = winner;
      this.endReason = "victory";
      for (const p of this.players.values()) p.ready = false;
      this.emit({ type: "phase", data: { phase: "matchEnd", round: this.round, loop: this.loop, winner } });
    } else {
      this.phase = "roundEnd";
      this.phaseLeft = ROUND_END_DURATION;
      this.emit({ type: "phase", data: { phase: "roundEnd", round: this.round, loop: this.loop, winner } });
    }
  }

  private pickRespawn(side: Side) {
    const enemies = [...this.units.values()].filter((u) => u.side !== side && u.kind !== "ghost");
    let best = SPAWNS[side][0];
    let bestD = -1;
    for (const sp of SPAWNS[side]) {
      let d = Infinity;
      for (const e of enemies) d = Math.min(d, Math.hypot(e.move.x - sp.x, e.move.z - sp.z));
      if (d > bestD) {
        bestD = d;
        best = sp;
      }
    }
    return best;
  }

  // ---------------------------------------------------------------- input
  input(id: string, m: InputMsg) {
    const p = this.players.get(id);
    if (!p || !isFiniteInput(m)) return;
    if (m.seq > p.lastSeq) p.lastSeq = m.seq;
    const u = p.unitId ? this.units.get(p.unitId) : undefined;
    if (!u || u.kind !== "live") return;
    u.yaw = wrapAngle(m.yaw);
    u.pitch = clamp(m.pitch, -1.5, 1.5);
    if (this.phase !== "loop" || this.paused) return;
    let dt = clamp(m.dt, 0, 0.05);
    if (p.budget < dt * 0.5) return; // speed-hack / burst protection
    dt = Math.min(dt, p.budget);
    p.budget -= dt;
    const recentlyFired = this.time - p.lastFire < 0.3;
    const inp = {
      mx: clamp(m.mx, -1, 1),
      mz: clamp(m.mz, -1, 1),
      yaw: u.yaw,
      jump: !!m.jump,
      sprint: !!m.sprint && !recentlyFired && !p.reloadEnd,
      crouch: !!m.crouch,
      ads: !!m.ads,
    };
    stepMove(u.move, inp, dt);
    u.ads = inp.ads;
    u.sprint = isSprinting(inp, u.move);
    u.speed = Math.hypot(u.move.vx, u.move.vz);
  }

  reload(id: string) {
    const p = this.players.get(id);
    if (!p || this.phase !== "loop" || this.paused) return;
    if (p.reloadEnd || p.ammo >= RIFLE.magSize) return;
    p.reloadEnd = this.time + RIFLE.reloadTime;
  }

  fire(id: string, m: FireMsg): boolean {
    const p = this.players.get(id);
    if (!p || this.phase !== "loop" || this.paused) return false;
    const u = p.unitId ? this.units.get(p.unitId) : undefined;
    if (!u || u.kind !== "live") return false;
    if (p.reloadEnd || p.ammo <= 0) return false;
    if (p.fireTokens < 1) return false;
    const len = Math.hypot(m.dx, m.dy, m.dz);
    if (!Number.isFinite(len) || len < 0.5) return false;
    const dir = { x: m.dx / len, y: m.dy / len, z: m.dz / len };
    if (!Number.isFinite(m.yaw) || !Number.isFinite(m.pitch)) return false;
    const view = dirFromAngles(m.yaw, clamp(m.pitch, -1.5, 1.5));
    if (angleBetween(dir, view) > MAX_SPREAD_CHECK) return false;
    u.yaw = wrapAngle(m.yaw);
    u.pitch = clamp(m.pitch, -1.5, 1.5);
    u.sprint = false;
    p.ammo--;
    p.fireTokens -= 1;
    p.lastFire = this.time;
    if (p.ammo <= 0) p.reloadEnd = this.time + RIFLE.reloadTime + 0.15;

    const origin = this.eyePos(u);
    const rewind = clamp(Number(m.rewind) || 0, 0, MAX_REWIND_MS) / 1000;
    const poseAt = this.historyAt(this.time - rewind);
    const res = this.trace(origin, dir, u.side, (t) => poseAt.get(t.id) ?? poseOf(t));
    let dmg = 0;
    if (res.unit) {
      dmg = res.head ? RIFLE.damageHead : RIFLE.damageBody;
      dmg = this.applyDamage(res.unit, dmg, res.head, u, origin);
    }
    u.track.shots.push({
      t: this.loopTime,
      dx: dir.x,
      dy: dir.y,
      dz: dir.z,
      target: res.unit ? res.unit.id : null,
      dist: res.dist,
      head: res.head,
      dmg,
    });
    this.emitShot(u, origin, dir, res, m.id | 0, false);
    return true;
  }

  // ---------------------------------------------------------------- combat
  private eyePos(u: SimUnit): Vec3 {
    return { x: u.move.x, y: u.move.y + eyeOf(u.move.crouching), z: u.move.z };
  }

  /** Hitscan against geometry and enemy units (friendly units never block). */
  trace(o: Vec3, d: Vec3, shooterSide: number, pose: (u: SimUnit) => HitboxPose, exclude?: string): TraceResult {
    const world = raycastWorld(o, d, RIFLE.range);
    let best: TraceResult = { dist: world.t, normal: [world.nx, world.ny, world.nz], unit: null, head: false };
    if (world.t >= RIFLE.range) best.normal = null;
    for (const t of this.units.values()) {
      if (t.side === shooterSide || t.kind === "ghost" || t.id === exclude) continue;
      const h = rayCharacter(o, d, pose(t), best.dist);
      if (h && h.t < best.dist) best = { dist: h.t, normal: null, unit: t, head: h.head };
    }
    return best;
  }

  private replayShot(u: SimUnit, s: ShotRec) {
    const origin = this.eyePos(u);
    const dir = { x: s.dx, y: s.dy, z: s.dz };
    const recorded = s.target ? this.units.get(s.target) : undefined;
    const recordedAlive = !!recorded && recorded.kind !== "ghost" && recorded.side !== u.side;
    // Something else (a new live player, another clone) may now stand in the way.
    const other = this.trace(origin, dir, u.side, poseOf, recordedAlive ? recorded!.id : undefined);
    let res: TraceResult;
    let dmg = 0;
    if (recordedAlive && !(other.unit && other.dist < s.dist - 0.35)) {
      res = { dist: s.dist, normal: null, unit: recorded!, head: s.head };
      dmg = this.applyDamage(recorded!, s.dmg, s.head, u, origin);
    } else {
      res = other;
      if (other.unit) dmg = this.applyDamage(other.unit, other.head ? RIFLE.damageHead : RIFLE.damageBody, other.head, u, origin);
    }
    void dmg;
    this.emitShot(u, origin, dir, res, -1, true);
  }

  private applyDamage(target: SimUnit, dmg: number, head: boolean, shooter: SimUnit, from: Vec3): number {
    if (target.kind === "ghost") return 0;
    if (target.kind === "live" && this.loopTime < target.protUntil) dmg = 0;
    target.hp = Math.max(0, target.hp - dmg);
    this.emit({
      type: "hit",
      data: {
        target: target.id,
        targetOwner: target.ownerId,
        shooter: shooter.id,
        shooterOwner: shooter.ownerId,
        dmg,
        head,
        from: [from.x, from.y, from.z],
        hp: target.hp,
      },
    });
    if (target.hp <= 0) this.kill(target, shooter, head);
    return dmg;
  }

  private kill(target: SimUnit, killer: SimUnit, head: boolean) {
    const kp = this.players.get(killer.ownerId);
    if (kp) kp.kills++;
    this.emit({
      type: "kill",
      data: {
        victim: target.id,
        victimKind: target.kind,
        victimSide: target.side,
        victimName: target.ownerName,
        killer: killer.id,
        killerSide: killer.side,
        killerName: killer.ownerName,
        head,
        pos: [target.move.x, target.move.y, target.move.z],
      },
    });
    if (target.kind === "live") {
      const p = this.players.get(target.ownerId);
      target.track.endT = this.loopTime;
      target.track.endReason = "death";
      this.recordFrame(target);
      this.units.delete(target.id);
      if (p) {
        p.deaths++;
        p.unitId = null;
        const at = this.loopTime + RESPAWN_DELAY;
        p.respawnAt = p.tracksThisLoop < MAX_TRACKS_PER_LOOP && at < LOOP_DURATION - 1 ? at : null;
        p.reloadEnd = 0;
      }
    } else if (target.kind === "clone") {
      const tr = target.track;
      const fulfilled = tr.endReason === "death" && Math.abs(this.loopTime - tr.endT) <= 0.2;
      target.kind = "ghost";
      if (!fulfilled && kp) kp.erased++;
      this.emitParadox(fulfilled ? "fulfilled" : "erased", target);
    } else if (target.kind === "anomaly") {
      target.kind = "ghost";
      if (kp) kp.erased++;
      this.emitParadox("erased", target);
    }
  }

  private stepAnomaly(u: SimUnit, dt: number) {
    const ai = u.ai!;
    const eye = this.eyePos(u);
    let best: SimUnit | null = null;
    let bestD = Infinity;
    for (const t of this.units.values()) {
      if (t.side === u.side || t.kind === "ghost") continue;
      const dx = t.move.x - u.move.x,
        dz = t.move.z - u.move.z;
      const d = Math.hypot(dx, dz);
      if (d > ANOMALY.range || d >= bestD) continue;
      const yawTo = Math.atan2(-dx, -dz);
      if (d > 7 && Math.abs(wrapAngle(yawTo - u.yaw)) > ANOMALY.fov) continue;
      const chest = { x: t.move.x, y: t.move.y + (t.move.crouching ? 0.8 : 1.2), z: t.move.z };
      if (!hasLineOfSight(eye, chest)) continue;
      best = t;
      bestD = d;
    }
    if (!best) {
      ai.targetId = null;
      ai.seenFor = 0;
      return;
    }
    if (ai.targetId !== best.id) {
      ai.targetId = best.id;
      ai.seenFor = 0;
    }
    ai.seenFor += dt;
    const chest = { x: best.move.x, y: best.move.y + (best.move.crouching ? 0.8 : 1.2), z: best.move.z };
    const dx = chest.x - eye.x,
      dy = chest.y - eye.y,
      dz = chest.z - eye.z;
    const wantYaw = Math.atan2(-dx, -dz);
    const wantPitch = Math.atan2(dy, Math.hypot(dx, dz));
    const dyaw = wrapAngle(wantYaw - u.yaw);
    const maxTurn = ANOMALY.turnRate * dt;
    u.yaw = wrapAngle(u.yaw + clamp(dyaw, -maxTurn, maxTurn));
    u.pitch = wantPitch;
    u.ads = true;
    if (ai.seenFor < ANOMALY.reactionTime || Math.abs(wrapAngle(wantYaw - u.yaw)) > 0.15) return;
    if (this.loopTime < ai.nextShot) return;
    const len = Math.hypot(dx, dy, dz) || 1;
    const sp = ANOMALY.spread;
    let d = { x: dx / len + (this.rng() - 0.5) * 2 * sp, y: dy / len + (this.rng() - 0.5) * 2 * sp, z: dz / len + (this.rng() - 0.5) * 2 * sp };
    const l2 = Math.hypot(d.x, d.y, d.z);
    d = { x: d.x / l2, y: d.y / l2, z: d.z / l2 };
    const res = this.trace(eye, d, u.side, poseOf);
    if (res.unit) this.applyDamage(res.unit, res.head ? ANOMALY.damage * 2 : ANOMALY.damage, res.head, u, eye);
    this.emitShot(u, eye, d, res, -1, true);
    ai.burstLeft--;
    if (ai.burstLeft <= 0) {
      ai.burstLeft = ANOMALY.burst;
      ai.nextShot = this.loopTime + ANOMALY.burstPause;
    } else ai.nextShot = this.loopTime + ANOMALY.burstInterval;
  }

  // ---------------------------------------------------------------- timeline
  private recordFrame(u: SimUnit) {
    const fr = u.track.frames;
    const last = fr[fr.length - 1];
    if (last && last.t === this.loopTime) fr.pop();
    fr.push({
      t: this.loopTime,
      x: u.move.x,
      y: u.move.y,
      z: u.move.z,
      yaw: u.yaw,
      pitch: u.pitch,
      c: u.move.crouching,
      a: u.ads,
      s: u.speed,
    });
  }

  private replayPose(u: SimUnit) {
    const fr = u.track.frames;
    const t = Math.min(this.loopTime, u.track.endT);
    while (u.frameIdx < fr.length - 1 && fr[u.frameIdx + 1].t <= t) u.frameIdx++;
    const a = fr[u.frameIdx];
    const b = fr[Math.min(u.frameIdx + 1, fr.length - 1)];
    const k = b.t > a.t ? clamp((t - a.t) / (b.t - a.t), 0, 1) : 0;
    u.move.x = a.x + (b.x - a.x) * k;
    u.move.y = a.y + (b.y - a.y) * k;
    u.move.z = a.z + (b.z - a.z) * k;
    u.move.crouching = k < 0.5 ? a.c : b.c;
    u.yaw = a.yaw + wrapAngle(b.yaw - a.yaw) * k;
    u.pitch = a.pitch + (b.pitch - a.pitch) * k;
    u.ads = a.a;
    u.speed = a.s + (b.s - a.s) * k;
  }

  private pushHistory() {
    const poses = new Map<string, HitboxPose>();
    for (const u of this.units.values()) poses.set(u.id, poseOf(u));
    this.history.push({ time: this.time, poses });
    while (this.history.length && this.history[0].time < this.time - 1) this.history.shift();
  }

  /** Interpolated hitbox poses at a past simulation time (lag compensation). */
  private historyAt(t: number): Map<string, HitboxPose> {
    const h = this.history;
    if (!h.length || t >= h[h.length - 1].time) return new Map();
    let i = h.length - 1;
    while (i > 0 && h[i - 1].time > t) i--;
    const b = h[i];
    const a = h[Math.max(0, i - 1)];
    const k = b.time > a.time ? clamp((t - a.time) / (b.time - a.time), 0, 1) : 1;
    const out = new Map<string, HitboxPose>();
    for (const [id, pb] of b.poses) {
      const pa = a.poses.get(id);
      if (!pa) {
        out.set(id, pb);
        continue;
      }
      out.set(id, {
        x: pa.x + (pb.x - pa.x) * k,
        y: pa.y + (pb.y - pa.y) * k,
        z: pa.z + (pb.z - pa.z) * k,
        crouch: k < 0.5 ? pa.crouch : pb.crouch,
      });
    }
    return out;
  }

  // ---------------------------------------------------------------- events
  private emit(e: ServerEvent) {
    this.events.push(e);
  }

  private emitShot(u: SimUnit, o: Vec3, d: Vec3, r: TraceResult, id: number, replay: boolean) {
    this.emit({
      type: "shot",
      data: {
        u: u.id,
        side: u.side,
        o: [o.x, o.y, o.z],
        d: [d.x, d.y, d.z],
        e: r.dist,
        h: r.unit ? r.unit.id : null,
        hd: r.head,
        n: r.normal,
        id,
        replay,
      },
    });
  }

  private emitParadox(type: ParadoxType, u: SimUnit) {
    this.emit({
      type: "paradox",
      data: { type, unit: u.id, side: u.side, ownerName: u.ownerName, loop: u.loop, pos: [u.move.x, u.move.y, u.move.z] },
    });
  }

  drainEvents(): ServerEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }
}

export function poseOf(u: SimUnit): HitboxPose {
  return { x: u.move.x, y: u.move.y, z: u.move.z, crouch: u.move.crouching };
}

export function sanitizeName(name: unknown): string {
  const s = String(name ?? "")
    .replace(/[\u0000-\u001f<>]/g, "")
    .trim()
    .slice(0, 16);
  return s || "Player";
}

function isFiniteInput(m: InputMsg): boolean {
  return (
    !!m &&
    Number.isFinite(m.seq) &&
    Number.isFinite(m.dt) &&
    Number.isFinite(m.mx) &&
    Number.isFinite(m.mz) &&
    Number.isFinite(m.yaw) &&
    Number.isFinite(m.pitch)
  );
}
