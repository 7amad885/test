// Client game runtime (non-React): fixed-step input + client-side prediction
// with server reconciliation, interpolation of remote units, weapon handling,
// event-driven effects/HUD, and recording of the loop for the rewind cinematic.

import * as THREE from "three";
import { create } from "zustand";
import {
  FIRE_INTERVAL,
  INTERP_DELAY_MS,
  LOOP_DURATION,
  REWIND_DURATION,
  RIFLE,
  SIDE_COLORS,
  SIDE_NAMES,
  STAND_EYE,
  TICK_DT,
  WALK_SPEED,
} from "../../shared/constants";
import { POINT_CENTER } from "../../shared/map";
import {
  dirFromAngles,
  eyeOf,
  newMoveState,
  raycastWorld,
  rayCharacter,
  stepMove,
  type MoveInput,
  type Vec3,
} from "../../shared/physics";
import type { InputMsg, ServerEvent } from "../../shared/protocol";
import { audio } from "../audio";
import { input } from "../input/InputManager";
import { net, type UnitSnap } from "../net/NetClient";
import { useUI } from "../store";

export interface RenderUnit extends UnitSnap {
  id: string;
  side: number;
  name: string;
  loop: number;
  rewind?: boolean;
}

export interface Tracer {
  o: THREE.Vector3;
  e: THREE.Vector3;
  side: number;
  echo: boolean;
  t0: number;
}
export interface Impact {
  p: THREE.Vector3;
  n: THREE.Vector3;
  kind: "world" | "unit";
  side: number;
  t0: number;
}
export interface ParadoxFx {
  type: string;
  p: THREE.Vector3;
  side: number;
  t0: number;
}
export interface DeathFx {
  unit: RenderUnit;
  t0: number;
}

interface HistFrame {
  t: number;
  cam: [number, number, number, number, number];
  units: RenderUnit[];
}

export interface HudState {
  phase: string;
  round: number;
  loop: number;
  timeLeft: number;
  meter: number;
  capture: number;
  wins: [number, number];
  hp: number;
  ammo: number;
  reloading: boolean;
  ping: number;
  oppPing: number;
  alive: boolean;
  respawnIn: number;
  side: number;
  myName: string;
  oppName: string;
  oppConnected: boolean;
  oppDevice: string;
  paused: boolean;
  pauseLeft: number;
  echoes: [number, number];
  anomalies: [number, number];
  lastRoundWinner: number;
  matchWinner: number;
  endReason: string;
  stats: { name: string; side: number; kills: number; deaths: number; erased: number; rescued: number }[];
  connected: boolean;
  reconnecting: boolean;
  onPoint: boolean;
}

export const useHud = create<HudState>(() => ({
  phase: "lobby",
  round: 0,
  loop: 0,
  timeLeft: 0,
  meter: 0,
  capture: -1,
  wins: [0, 0],
  hp: 100,
  ammo: RIFLE.magSize,
  reloading: false,
  ping: 0,
  oppPing: 0,
  alive: false,
  respawnIn: 0,
  side: 0,
  myName: "",
  oppName: "",
  oppConnected: false,
  oppDevice: "",
  paused: false,
  pauseLeft: 0,
  echoes: [0, 0],
  anomalies: [0, 0],
  lastRoundWinner: -1,
  matchWinner: -1,
  endReason: "",
  stats: [],
  connected: false,
  reconnecting: false,
  onPoint: false,
}));

const tmpSnap = (): UnitSnap => ({ t: 0, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, crouch: false, ads: false, sprint: false, speed: 0, hp: 100, kind: "live" });
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export class GameRuntime {
  // ---- prediction
  move = newMoveState(0, 0, 0);
  prevPos = new THREE.Vector3();
  curPos = new THREE.Vector3();
  renderPos = new THREE.Vector3();
  smooth = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  recoil = 0;
  recoilYaw = 0;
  private seq = 0;
  private pending: InputMsg[] = [];
  private outbox: InputMsg[] = [];
  private acc = 0;
  myUnitId = "";
  alive = false;
  side = 0;
  eyeH = STAND_EYE;
  landDip = 0;
  bobPhase = 0;
  private stepDist = 0;
  sprinting = false;

  // ---- weapon
  ammo: number = RIFLE.magSize;
  reloading = false;
  reloadStart = 0;
  reloadEnd = 0;
  private autoReloadAt = 0;
  private nextFire = 0;
  lastFire = -10;
  fireCount = 0;
  heat = 0;
  adsBlend = 0;
  spread: number = RIFLE.hipSpread;
  muzzleWorld = new THREE.Vector3();
  private shotId = 1;

  // ---- hud / feedback
  hp = 100;
  damageFlash = 0;
  hitmarkerT = -10;
  hitHead = false;
  killT = -10;
  dmgIndicators: { yaw: number; t: number }[] = [];
  deathPos: THREE.Vector3 | null = null;
  killerId: string | null = null;
  shake = 0;
  glitch = 0;

  // ---- world
  phase = "lobby";
  units = new Map<string, RenderUnit>();
  unitVersion = 0;
  private history: HistFrame[] = [];
  private histTimer = 0;
  rewindStart = 0;
  rewindUnits: RenderUnit[] = [];
  rewindProgress = 0;
  private rewindCam: [number, number, number, number, number] | null = null;
  private hudTimer = 0;
  private lastCapture = -1;

  // ---- effects bus (consumed by Effects/Characters)
  tracers: Tracer[] = [];
  impacts: Impact[] = [];
  paradoxFx: ParadoxFx[] = [];
  deaths: DeathFx[] = [];
  muzzles = new Map<string, number>();
  shellsToSpawn = 0;

  camera: THREE.PerspectiveCamera | null = null;
  private inited = false;

  init() {
    if (this.inited) return;
    this.inited = true;
    net.onEvent((e) => this.onEvent(e));
    net.onState(() => this.onState());
  }

  get now() {
    return performance.now() / 1000;
  }

  // =================================================================== state
  private onState() {
    const s = net.state;
    if (!s) {
      useHud.setState({ connected: net.connected, reconnecting: net.reconnecting });
      return;
    }
    if (s.phase !== this.phase) this.onPhase(s.phase, this.phase);
    const ps = s.players.get(net.me);
    if (!ps) return;
    this.side = ps.side;
    const uid: string = ps.unitId;
    if (uid !== this.myUnitId) {
      this.myUnitId = uid;
      const u = uid ? s.units.get(uid) : null;
      if (u) {
        Object.assign(this.move, { x: u.x, y: u.y, z: u.z, vx: 0, vy: 0, vz: 0, onGround: true, crouching: false });
        this.yaw = u.yaw;
        this.pitch = 0;
        this.recoil = this.recoilYaw = 0;
        this.pending = [];
        this.prevPos.set(u.x, u.y, u.z);
        this.curPos.copy(this.prevPos);
        this.smooth.set(0, 0, 0);
        this.alive = true;
        this.ammo = RIFLE.magSize;
        this.reloading = false;
        this.autoReloadAt = 0;
        this.hp = u.hp;
        this.deathPos = null;
        this.killerId = null;
        input.crouchToggled = false;
      } else this.alive = false;
      return;
    }
    if (!uid) return;
    const u = s.units.get(uid);
    if (!u) return;
    if (u.hp < this.hp) this.damageFlash = Math.min(1, this.damageFlash + (this.hp - u.hp) / 60);
    this.hp = u.hp;
    // ---- reconciliation
    this.pending = this.pending.filter((m) => m.seq > ps.lastSeq);
    const ox = this.move.x,
      oy = this.move.y,
      oz = this.move.z;
    Object.assign(this.move, { x: u.x, y: u.y, z: u.z, vx: u.vx, vy: u.vy, vz: u.vz, onGround: u.ground, crouching: u.crouch });
    if (s.phase === "loop") for (const m of this.pending) stepMove(this.move, toMove(m), m.dt);
    const dx = ox - this.move.x,
      dy = oy - this.move.y,
      dz = oz - this.move.z;
    if (Math.hypot(dx, dy, dz) < 2) {
      this.smooth.x += dx;
      this.smooth.y += dy;
      this.smooth.z += dz;
    } else this.smooth.set(0, 0, 0);
    this.prevPos.x -= dx;
    this.prevPos.y -= dy;
    this.prevPos.z -= dz;
    this.curPos.set(this.move.x, this.move.y, this.move.z);
    // ammo resync when idle
    if (!this.reloading && this.now - this.lastFire > 1 && !ps.reloading && ps.ammo !== this.ammo) this.ammo = ps.ammo;
  }

  private onPhase(phase: string, prev: string) {
    this.phase = phase;
    const ui = useUI.getState();
    if (phase === "rewind") {
      this.rewindStart = this.now;
      audio.rewind(REWIND_DURATION - 0.3);
      this.glitch = 1;
    }
    if (phase === "loop" || phase === "countdown") {
      this.history = [];
      this.rewindUnits = [];
      this.rewindCam = null;
      if (prev === "rewind") this.glitch = 1.2;
    }
    if (phase === "countdown" || phase === "lobby") {
      this.reloading = false;
      this.ammo = RIFLE.magSize;
    }
    if (phase === "matchEnd" || phase === "lobby") {
      input.resetActions();
      audio.setCapture(-1, 0);
      if (document.pointerLockElement) document.exitPointerLock();
    }
    void ui;
  }

  private onEvent(e: ServerEvent) {
    const ui = useUI.getState();
    const s = net.state;
    switch (e.type) {
      case "shot": {
        const d = e.data;
        const o = new THREE.Vector3(...d.o);
        const dir = new THREE.Vector3(...d.d);
        const end = o.clone().addScaledVector(dir, d.e);
        if (d.u === this.myUnitId && d.id >= 0) return; // already predicted locally
        this.muzzles.set(d.u, this.now);
        // muzzle of a third-person rifle: forward/right/down of the eye
        const right = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
        const mo = o.clone().addScaledVector(dir, 0.7).addScaledVector(right, 0.2).add(new THREE.Vector3(0, -0.22, 0));
        this.tracers.push({ o: mo, e: end, side: d.side, echo: d.replay, t0: this.now });
        if (d.h) this.impacts.push({ p: end, n: dir.clone().negate(), kind: "unit", side: d.side, t0: this.now });
        else if (d.n) this.impacts.push({ p: end, n: new THREE.Vector3(...d.n), kind: "world", side: d.side, t0: this.now });
        audio.gunshot({ x: o.x, y: o.y, z: o.z }, { echo: d.replay, volume: d.replay ? 0.75 : 1 });
        break;
      }
      case "hit": {
        const d = e.data;
        if (d.target === this.myUnitId && d.dmg > 0) {
          const dx = d.from[0] - this.renderPos.x,
            dz = d.from[2] - this.renderPos.z;
          this.dmgIndicators.push({ yaw: Math.atan2(-dx, -dz), t: this.now });
          if (this.dmgIndicators.length > 6) this.dmgIndicators.shift();
          this.shake = Math.min(1, this.shake + 0.35);
          this.damageFlash = Math.min(1, this.damageFlash + d.dmg / 60);
          audio.hurt();
        }
        if (d.shooter === this.myUnitId && d.dmg > 0) {
          this.hitmarkerT = this.now;
          this.hitHead = d.head;
          audio.hitmarker(d.head);
        }
        break;
      }
      case "kill": {
        const d = e.data;
        const victimUnit = this.units.get(d.victim);
        const vName = d.victimKind === "live" ? d.victimName : `${d.victimName}'s echo`;
        const killerUnit = s?.units.get(d.killer);
        const kName = killerUnit && killerUnit.kind !== "live" ? `${d.killerName}'s echo` : d.killerName;
        ui.pushFeed(`${kName} ${d.head ? "⌖" : "→"} ${vName}`, SIDE_COLORS[d.killerSide]);
        if (d.victim === this.myUnitId) {
          this.alive = false;
          this.deathPos = new THREE.Vector3(...d.pos);
          this.killerId = d.killer;
          this.glitch = Math.max(this.glitch, 0.6);
        }
        if (d.killer === this.myUnitId) {
          this.killT = this.now;
          audio.kill();
        }
        if (victimUnit && d.victimKind === "live") this.deaths.push({ unit: { ...victimUnit }, t0: this.now });
        break;
      }
      case "paradox": {
        const d = e.data;
        const mine = d.side === this.side;
        const p = new THREE.Vector3(...d.pos);
        this.paradoxFx.push({ type: d.type, p, side: d.side, t0: this.now });
        const who = mine ? "Your" : `${d.ownerName}'s`;
        if (d.type === "rescued") {
          ui.announce("PARADOX", `${who} Loop ${d.loop} echo cheated its recorded death`, "#ffd36b");
          ui.pushFeed(`${who} L${d.loop} echo RESCUED — now an anomaly`, "#ffd36b", "∞");
          audio.paradox(true);
          this.glitch = Math.max(this.glitch, 0.8);
        } else if (d.type === "erased") {
          ui.announce("TIMELINE ERASED", `${who} Loop ${d.loop} echo was wiped from history`, mine ? "#ff4d6d" : SIDE_COLORS[this.side]);
          ui.pushFeed(`${who} L${d.loop} echo ERASED`, "#ff4d6d", "✕");
          audio.paradox(false);
          this.glitch = Math.max(this.glitch, 0.5);
        } else {
          ui.pushFeed(`History repeats: ${who.toLowerCase()} L${d.loop} echo fell`, "#9aa7b8", "↺");
        }
        break;
      }
      case "phase": {
        const d = e.data;
        const mySide = this.side;
        if (d.phase === "countdown") ui.announce(`ROUND ${d.round}`, "Capture the Paradox Point. Three loops. One timeline.", "#e8f6ff");
        if (d.phase === "loop") {
          const sub =
            d.loop === 1
              ? "Everything you do is being recorded"
              : d.loop === 2
                ? "Your Loop 1 echo replays beside you — change history"
                : "Final timeline: both echoes active. This loop decides the round";
          ui.announce(`LOOP ${d.loop} / 3`, sub, d.loop === 3 ? "#ffd36b" : "#7fe8ff");
        }
        if (d.phase === "rewind") ui.announce("REWINDING", "Time collapses to the start of the loop", "#b8a6ff");
        if (d.phase === "roundEnd") {
          const w = d.winner ?? -1;
          ui.announce(w < 0 ? "ROUND DRAW" : w === mySide ? "ROUND WON" : "ROUND LOST", w < 0 ? "The timeline is balanced" : `${SIDE_NAMES[w]} held the Paradox Point`, w < 0 ? "#cfd8e3" : SIDE_COLORS[w]);
        }
        if (d.phase === "matchEnd") {
          const w = d.winner ?? -1;
          ui.announce(w === mySide ? "VICTORY" : "DEFEAT", "", SIDE_COLORS[Math.max(0, w)]);
        }
        audio.announce();
        break;
      }
    }
  }

  // =================================================================== frame
  frame(dt: number, camera: THREE.PerspectiveCamera) {
    this.camera = camera;
    const s = net.state;
    const ui = useUI.getState();
    input.enabled = !ui.settingsOpen && !ui.layoutEditor;
    input.pollGamepad(dt);
    const now = this.now;

    // ---- look
    const [ldx, ldy] = input.consumeLook();
    this.yaw -= ldx;
    this.pitch = clamp(this.pitch - ldy, -1.45, 1.45);
    if (this.yaw > Math.PI) this.yaw -= Math.PI * 2;
    if (this.yaw < -Math.PI) this.yaw += Math.PI * 2;

    // ---- weapon timers
    if (this.autoReloadAt && now >= this.autoReloadAt) {
      this.autoReloadAt = 0;
      this.startReload();
    }
    if (this.reloading && now >= this.reloadEnd) {
      this.reloading = false;
      this.ammo = RIFLE.magSize;
    }
    if (input.reloadQueued) {
      input.reloadQueued = false;
      this.startReload();
    }

    // ---- fixed-step movement prediction
    this.acc = Math.min(this.acc + dt, TICK_DT * 8);
    while (this.acc >= TICK_DT) {
      this.acc -= TICK_DT;
      this.fixedStep();
    }
    if (this.outbox.length && s) {
      net.sendInputs(this.outbox);
      this.outbox = [];
    }
    const alpha = this.acc / TICK_DT;
    const decay = Math.exp(-dt * 12);
    this.smooth.multiplyScalar(decay);
    this.renderPos.lerpVectors(this.prevPos, this.curPos, alpha).add(this.smooth);

    // ---- ads / spread / recoil
    const wantAds = input.ads && this.alive && !this.reloading && !this.sprinting && this.phase === "loop";
    this.adsBlend = clamp(this.adsBlend + (wantAds ? 1 : -1) * (dt / RIFLE.adsTime), 0, 1);
    this.heat = Math.max(0, this.heat - dt * 5);
    const speed = Math.hypot(this.move.vx, this.move.vz);
    let spread = RIFLE.hipSpread + (RIFLE.adsSpread - RIFLE.hipSpread) * this.adsBlend;
    spread += RIFLE.moveSpreadAdd * Math.min(1, speed / WALK_SPEED) * (1 - this.adsBlend * 0.6);
    if (!this.move.onGround) spread += RIFLE.airSpreadAdd;
    if (this.move.crouching) spread *= RIFLE.crouchSpreadMult;
    spread += Math.min(0.02, this.heat * 0.0025);
    this.spread = Math.min(spread, RIFLE.hipSpread + RIFLE.moveSpreadAdd + RIFLE.airSpreadAdd);
    if (now - this.lastFire > 0.1) {
      const k = Math.exp(-dt * 7);
      this.recoil *= k;
      this.recoilYaw *= k;
    }

    // ---- remote units (interpolated)
    this.updateUnits(s);

    // ---- firing
    const canFire = this.phase === "loop" && this.alive && !this.reloading && !s?.paused && input.enabled;
    if (input.fire && canFire) {
      if (this.ammo <= 0) {
        if (!this.autoReloadAt) this.startReload();
      } else {
        if (now - this.nextFire > FIRE_INTERVAL) this.nextFire = now;
        let n = 0;
        while (now >= this.nextFire && this.ammo > 0 && n++ < 2) {
          this.doFire();
          this.nextFire += FIRE_INTERVAL;
        }
      }
    }

    // ---- crouch eye height, landing, bob
    const targetEye = eyeOf(this.move.crouching);
    this.eyeH += (targetEye - this.eyeH) * Math.min(1, dt * 12);
    this.landDip *= Math.exp(-dt * 9);
    if (this.move.onGround && speed > 0.5) this.bobPhase += dt * speed * 1.55;
    this.damageFlash = Math.max(0, this.damageFlash - dt * 0.9);
    this.shake = Math.max(0, this.shake - dt * 2.5);
    this.glitch = Math.max(0, this.glitch - dt * 0.9);

    // ---- loop history for the rewind cinematic
    if (this.phase === "loop") {
      this.histTimer += dt;
      if (this.histTimer > 0.1) {
        this.histTimer = 0;
        const units: RenderUnit[] = [];
        for (const u of this.units.values()) if (u.kind !== "ghost") units.push({ ...u });
        if (this.alive && s) units.push(this.selfUnit(s));
        this.history.push({ t: s?.loopTime ?? 0, cam: [camera.position.x, camera.position.y, camera.position.z, camera.rotation.y, camera.rotation.x], units });
        if (this.history.length > 420) this.history.shift();
      }
    }
    if (this.phase === "rewind") this.updateRewind(now);

    this.applyCamera(camera, dt);
    const fwd = dirFromAngles(this.yaw, this.pitch);
    audio.setListener(camera.position.x, camera.position.y, camera.position.z, fwd.x, fwd.y, fwd.z);

    // ---- capture hum + HUD snapshot (10 Hz)
    if (s && s.capture !== this.lastCapture) {
      this.lastCapture = s.capture;
      audio.setCapture(this.phase === "loop" ? s.capture : -1, this.side);
    }
    this.hudTimer += dt;
    if (this.hudTimer > 0.1) {
      this.hudTimer = 0;
      this.pushHud();
    }
  }

  private fixedStep() {
    const s = net.state;
    const canMove = this.phase === "loop" && this.alive && !s?.paused;
    const mv = input.move();
    const now = this.now;
    const sprint = input.sprint(TICK_DT) && now - this.lastFire > 0.3 && !this.reloading;
    const msg: InputMsg = {
      seq: ++this.seq,
      dt: TICK_DT,
      mx: canMove ? mv.x : 0,
      mz: canMove ? mv.z : 0,
      yaw: this.yaw + this.recoilYaw,
      pitch: clamp(this.pitch + this.recoil, -1.5, 1.5),
      jump: canMove && input.jumpQueued,
      sprint: canMove && sprint,
      crouch: input.crouch,
      ads: input.ads && !this.reloading,
    };
    input.jumpQueued = false;
    this.prevPos.copy(this.curPos);
    if (canMove) {
      const wasGround = this.move.onGround;
      const vy = this.move.vy;
      stepMove(this.move, toMove(msg), TICK_DT);
      this.sprinting = msg.sprint && msg.mz > 0.3 && !msg.ads && !this.move.crouching;
      if (!wasGround && this.move.onGround && vy < -3) {
        this.landDip = Math.min(0.18, -vy * 0.018);
        audio.footstep(undefined, 0.3);
      }
      const sp = Math.hypot(this.move.vx, this.move.vz);
      if (this.move.onGround && sp > 1.2 && !this.move.crouching) {
        this.stepDist += sp * TICK_DT;
        if (this.stepDist > (this.sprinting ? 2.5 : 2.0)) {
          this.stepDist = 0;
          audio.footstep(undefined, this.sprinting ? 0.22 : 0.15);
        }
      }
    } else this.sprinting = false;
    this.curPos.set(this.move.x, this.move.y, this.move.z);
    this.pending.push(msg);
    if (this.pending.length > 120) this.pending.shift();
    this.outbox.push(msg);
    if (this.outbox.length > 8) this.outbox.shift();
  }

  startReload() {
    if (this.reloading || this.ammo >= RIFLE.magSize || !this.alive || this.phase !== "loop") return;
    this.reloading = true;
    this.reloadStart = this.now;
    this.reloadEnd = this.now + RIFLE.reloadTime;
    input.sprintToggled = false;
    net.reload();
    audio.reload();
  }

  private doFire() {
    const now = this.now;
    const aimYaw = this.yaw + this.recoilYaw;
    const aimPitch = clamp(this.pitch + this.recoil, -1.5, 1.5);
    const fwd = dirFromAngles(aimYaw, aimPitch);
    // random direction inside the spread cone
    const f = new THREE.Vector3(fwd.x, fwd.y, fwd.z);
    const r = new THREE.Vector3().crossVectors(f, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(r, f).normalize();
    const a = Math.random() * Math.PI * 2;
    const rad = Math.tan(this.spread * Math.sqrt(Math.random()));
    const dir = f.clone().addScaledVector(r, Math.cos(a) * rad).addScaledVector(up, Math.sin(a) * rad).normalize();
    const eye = { x: this.move.x, y: this.move.y + eyeOf(this.move.crouching), z: this.move.z };
    net.fire({
      dx: dir.x,
      dy: dir.y,
      dz: dir.z,
      yaw: aimYaw,
      pitch: aimPitch,
      rewind: INTERP_DELAY_MS + net.rtt / 2,
      id: this.shotId++,
    });
    this.ammo--;
    this.lastFire = now;
    this.fireCount++;
    this.heat += 1;
    this.shellsToSpawn++;
    input.sprintToggled = false;
    const kick = (this.adsBlend > 0.5 ? 0.0065 : 0.012) * (this.move.crouching ? 0.75 : 1) * (0.85 + Math.random() * 0.3);
    this.recoil += kick;
    this.recoilYaw += (Math.random() - 0.45) * (this.adsBlend > 0.5 ? 0.003 : 0.007);
    if (this.ammo <= 0) this.autoReloadAt = now + 0.15;

    // predicted impact
    const world = raycastWorld(eye, dir, RIFLE.range);
    let dist = world.t;
    let hitUnit = false;
    for (const u of this.units.values()) {
      if (u.side === this.side || u.kind === "ghost") continue;
      const h = rayCharacter(eye, dir, { x: u.x, y: u.y, z: u.z, crouch: u.crouch }, dist);
      if (h) {
        dist = h.t;
        hitUnit = true;
      }
    }
    const end = new THREE.Vector3(eye.x, eye.y, eye.z).addScaledVector(dir, dist);
    this.tracers.push({ o: this.muzzleWorld.clone(), e: end, side: this.side, echo: false, t0: now });
    if (hitUnit) this.impacts.push({ p: end, n: dir.clone().negate(), kind: "unit", side: this.side, t0: now });
    else if (dist < RIFLE.range) this.impacts.push({ p: end, n: new THREE.Vector3(world.nx, world.ny, world.nz), kind: "world", side: this.side, t0: now });
    audio.gunshot();
  }

  private selfUnit(s: { players: Map<string, { name: string }>; units: Map<string, { loop: number }> }): RenderUnit {
    const me = s.players.get(net.me);
    return {
      id: this.myUnitId,
      side: this.side,
      name: me?.name ?? "",
      loop: s.units.get(this.myUnitId)?.loop ?? 1,
      t: 0,
      x: this.renderPos.x,
      y: this.renderPos.y,
      z: this.renderPos.z,
      yaw: this.yaw,
      pitch: this.pitch,
      crouch: this.move.crouching,
      ads: this.adsBlend > 0.5,
      sprint: this.sprinting,
      speed: Math.hypot(this.move.vx, this.move.vz),
      hp: this.hp,
      kind: "live",
    };
  }

  private updateUnits(s: ReturnType<() => typeof net.state>) {
    if (!s) {
      if (this.units.size) {
        this.units.clear();
        this.unitVersion++;
      }
      return;
    }
    const t = net.serverNow() - INTERP_DELAY_MS;
    const seen = new Set<string>();
    s.units.forEach((u: { id: string; side: number; name: string; loop: number }, id: string) => {
      if (id === this.myUnitId && this.alive) return;
      seen.add(id);
      let ru = this.units.get(id);
      if (!ru) {
        ru = { ...tmpSnap(), id, side: u.side, name: u.name, loop: u.loop };
        this.units.set(id, ru);
        this.unitVersion++;
      }
      net.sample(id, t, ru);
    });
    for (const id of [...this.units.keys()])
      if (!seen.has(id)) {
        this.units.delete(id);
        this.unitVersion++;
      }
  }

  private updateRewind(now: number) {
    const h = this.history;
    const p = clamp((now - this.rewindStart) / (REWIND_DURATION - 0.45), 0, 1);
    this.rewindProgress = p;
    if (h.length < 2) return;
    const e = p * p * (3 - 2 * p);
    const fi = (1 - e) * (h.length - 1);
    const i = Math.floor(fi);
    const k = fi - i;
    const a = h[i],
      b = h[Math.min(i + 1, h.length - 1)];
    this.rewindCam = a.cam.map((v, j) => {
      if (j === 3) {
        let d = b.cam[3] - v;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        return v + d * k;
      }
      return v + (b.cam[j] - v) * k;
    }) as HistFrame["cam"];
    const out: RenderUnit[] = [];
    for (const ua of a.units) {
      const ub = b.units.find((x) => x.id === ua.id);
      out.push(
        ub
          ? { ...ua, x: ua.x + (ub.x - ua.x) * k, y: ua.y + (ub.y - ua.y) * k, z: ua.z + (ub.z - ua.z) * k, speed: -ua.speed, rewind: true }
          : { ...ua, rewind: true },
      );
    }
    this.rewindUnits = out;
  }

  private applyCamera(cam: THREE.PerspectiveCamera, dt: number) {
    const s = net.state;
    const ui = useUI.getState();
    const baseFov = ui.settings.fov;
    let fov = baseFov * (1 - 0.3 * this.adsBlend) + (this.sprinting ? 6 : 0);
    cam.rotation.order = "YXZ";
    const t = this.now;
    if (this.phase === "rewind" && this.rewindCam) {
      const c = this.rewindCam;
      cam.position.set(c[0], c[1] + 0.3 * Math.sin(this.rewindProgress * Math.PI), c[2]);
      cam.rotation.set(c[4], c[3], Math.sin(t * 3) * 0.06 * Math.sin(this.rewindProgress * Math.PI));
      fov = baseFov + 18 * Math.sin(this.rewindProgress * Math.PI);
    } else if (!s || this.phase === "lobby" || (this.phase === "matchEnd" && !this.alive)) {
      // attract-mode orbit over the arena
      const a = t * 0.05;
      cam.position.set(Math.sin(a) * 26, 11 + Math.sin(t * 0.13) * 2, Math.cos(a) * 19);
      cam.lookAt(POINT_CENTER.x, 2, POINT_CENTER.z);
    } else if (!this.alive && this.deathPos) {
      const killer = this.killerId ? this.units.get(this.killerId) : undefined;
      const target = killer ? new THREE.Vector3(killer.x, killer.y + 1.2, killer.z) : new THREE.Vector3(POINT_CENTER.x, 1, POINT_CENTER.z);
      const away = this.deathPos.clone().sub(target).setY(0).normalize();
      const want = this.deathPos.clone().addScaledVector(away, 2.2).add(new THREE.Vector3(0, 2.6, 0));
      cam.position.lerp(want, Math.min(1, dt * 3));
      const m = new THREE.Matrix4().lookAt(cam.position, target, new THREE.Vector3(0, 1, 0));
      const q = new THREE.Quaternion().setFromRotationMatrix(m);
      cam.quaternion.slerp(q, Math.min(1, dt * 4));
      fov = baseFov;
    } else {
      const speed = Math.hypot(this.move.vx, this.move.vz);
      const bobAmt = Math.min(1, speed / WALK_SPEED) * (1 - this.adsBlend * 0.8) * (this.sprinting ? 1.5 : 1);
      const bobY = Math.sin(this.bobPhase * 2) * 0.028 * bobAmt;
      const bobX = Math.cos(this.bobPhase) * 0.018 * bobAmt;
      const sh = this.shake * 0.02;
      cam.position.set(
        this.renderPos.x + bobX * Math.cos(this.yaw) + (Math.random() - 0.5) * sh,
        this.renderPos.y + this.eyeH - this.landDip + bobY + (Math.random() - 0.5) * sh,
        this.renderPos.z - bobX * Math.sin(this.yaw),
      );
      // strafe roll
      const right = { x: Math.cos(this.yaw), z: -Math.sin(this.yaw) };
      const strafe = (this.move.vx * right.x + this.move.vz * right.z) / WALK_SPEED;
      cam.rotation.set(this.pitch + this.recoil, this.yaw + this.recoilYaw, -strafe * 0.012 + Math.sin(this.bobPhase) * 0.004 * bobAmt);
    }
    const k = Math.min(1, dt * 10);
    cam.fov += (fov - cam.fov) * k;
    cam.updateProjectionMatrix();
  }

  private pushHud() {
    const s = net.state;
    if (!s) {
      useHud.setState({ connected: net.connected, reconnecting: net.reconnecting });
      return;
    }
    let myName = "",
      oppName = "",
      oppConnected = false,
      oppPing = 0,
      oppDevice = "",
      respawnIn = 0;
    const stats: HudState["stats"] = [];
    s.players.forEach((p: { id: string; name: string; side: number; connected: boolean; ping: number; device: string; respawnIn: number; kills: number; deaths: number; erased: number; rescued: number }) => {
      stats.push({ name: p.name, side: p.side, kills: p.kills, deaths: p.deaths, erased: p.erased, rescued: p.rescued });
      if (p.id === net.me) {
        myName = p.name;
        respawnIn = p.respawnIn;
      } else {
        oppName = p.name;
        oppConnected = p.connected;
        oppPing = p.ping;
        oppDevice = p.device;
      }
    });
    const echoes: [number, number] = [0, 0];
    const anomalies: [number, number] = [0, 0];
    let onPoint = false;
    s.units.forEach((u: { kind: string; side: number; x: number; z: number; id: string }) => {
      if (u.kind === "clone") echoes[u.side]++;
      if (u.kind === "anomaly") anomalies[u.side]++;
    });
    if (this.alive && Math.hypot(this.move.x - POINT_CENTER.x, this.move.z - POINT_CENTER.z) < 4.6) onPoint = true;
    useHud.setState({
      phase: s.phase,
      round: s.round,
      loop: s.loop,
      timeLeft: s.phase === "loop" ? Math.max(0, LOOP_DURATION - s.loopTime) : s.phaseLeft,
      meter: s.meter,
      capture: s.capture,
      wins: [s.wins0, s.wins1],
      hp: this.alive ? this.hp : 0,
      ammo: this.ammo,
      reloading: this.reloading,
      ping: Math.round(net.rtt),
      oppPing,
      alive: this.alive,
      respawnIn,
      side: this.side,
      myName,
      oppName,
      oppConnected,
      oppDevice,
      paused: s.paused,
      pauseLeft: s.pauseLeft,
      echoes,
      anomalies,
      lastRoundWinner: s.lastRoundWinner,
      matchWinner: s.matchWinner,
      endReason: s.endReason,
      stats,
      connected: net.connected,
      reconnecting: net.reconnecting,
      onPoint,
    });
  }
}

function toMove(m: InputMsg): MoveInput {
  return { mx: m.mx, mz: m.mz, yaw: m.yaw, jump: m.jump, sprint: m.sprint, crouch: m.crouch, ads: m.ads };
}

export const game = new GameRuntime();
export type { Vec3 };
