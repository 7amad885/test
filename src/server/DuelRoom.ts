// Private 1v1 room. Owns a MatchSim, runs it at TICK_RATE, mirrors it into the
// Colyseus state and broadcasts combat/timeline events.

import { Room, type Client } from "@colyseus/core";
import { PATCH_RATE, RECONNECT_WINDOW, TICK_DT, TICK_RATE } from "../shared/constants";
import type { FireMsg, InputMsg } from "../shared/protocol";
import { DuelState, PlayerState, UnitState } from "./schema";
import { MatchSim, sanitizeName } from "./sim";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const activeCodes = new Set<string>();

export function generateCode(): string {
  for (;;) {
    let c = "";
    for (let i = 0; i < 5; i++) c += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    if (!activeCodes.has(c)) return c;
  }
}

export class DuelRoom extends Room<DuelState> {
  maxClients = 2;
  private sim = new MatchSim();
  private started = Date.now();
  private reconnectDeadline = new Map<string, number>();

  onCreate() {
    const code = generateCode();
    activeCodes.add(code);
    this.roomId = code;
    this.setState(new DuelState());
    this.state.code = code;
    this.setPrivate(true);
    this.setPatchRate(1000 / PATCH_RATE);
    this.setSeatReservationTime(20);

    this.onMessage("input", (client, msg: InputMsg | InputMsg[]) => {
      const list = Array.isArray(msg) ? msg.slice(0, 12) : [msg];
      for (const m of list) this.sim.input(client.sessionId, m);
    });
    this.onMessage("fire", (client, msg: FireMsg) => {
      if (this.sim.fire(client.sessionId, msg)) this.flushEvents();
    });
    this.onMessage("reload", (client) => this.sim.reload(client.sessionId));
    this.onMessage("ready", (client, msg: { ready?: boolean }) => {
      this.sim.setReady(client.sessionId, !!msg?.ready);
      this.sync();
      this.flushEvents();
    });
    this.onMessage("ping", (client, msg: { c: number; rtt?: number }) => {
      client.send("pong", { c: msg?.c });
      const p = this.sim.players.get(client.sessionId);
      if (p && Number.isFinite(msg?.rtt)) p.ping = Math.max(0, Math.min(9999, Math.round(msg.rtt!)));
    });
    this.onMessage("device", (client, msg: { d?: string }) => {
      const ps = this.state.players.get(client.sessionId);
      if (ps) ps.device = String(msg?.d ?? "").slice(0, 12);
    });

    // Fixed-step simulation driven by real elapsed time, so the authoritative
    // clock never drifts from wall time even if the timer fires late.
    let acc = 0;
    this.setSimulationInterval((deltaMs) => {
      acc = Math.min(acc + deltaMs / 1000, TICK_DT * 6);
      let steps = 0;
      while (acc >= TICK_DT) {
        acc -= TICK_DT;
        this.sim.update(TICK_DT);
        steps++;
      }
      if (steps) {
        this.sync();
        this.flushEvents();
      }
    }, 1000 / TICK_RATE);
  }

  onJoin(client: Client, options: { name?: string; device?: string }) {
    const p = this.sim.addPlayer(client.sessionId, sanitizeName(options?.name));
    if (!p) throw new Error("Room is full");
    const ps = new PlayerState();
    ps.id = client.sessionId;
    ps.device = String(options?.device ?? "").slice(0, 12);
    this.state.players.set(client.sessionId, ps);
    this.sync();
  }

  async onLeave(client: Client, consented: boolean) {
    const id = client.sessionId;
    const lobby = this.sim.phase === "lobby" || this.sim.phase === "matchEnd";
    if (consented && lobby) {
      this.removePlayer(id);
      return;
    }
    this.sim.setConnected(id, false);
    this.reconnectDeadline.set(id, Date.now() + RECONNECT_WINDOW * 1000);
    this.sync();
    try {
      if (consented) throw new Error("left");
      await this.allowReconnection(client, RECONNECT_WINDOW);
      this.reconnectDeadline.delete(id);
      this.sim.setConnected(id, true);
      this.sync();
    } catch {
      this.reconnectDeadline.delete(id);
      this.sim.forfeit(id);
      this.removePlayer(id);
      this.flushEvents();
    }
  }

  onDispose() {
    activeCodes.delete(this.roomId);
  }

  private removePlayer(id: string) {
    this.sim.removePlayer(id);
    this.state.players.delete(id);
    this.sim.paused = this.sim.inMatch && [...this.sim.players.values()].some((q) => !q.connected);
    this.sync();
  }

  private flushEvents() {
    const ev = this.sim.drainEvents();
    if (ev.length) this.broadcast("ev", ev);
  }

  private sync() {
    const s = this.state;
    const sim = this.sim;
    s.phase = sim.phase;
    s.phaseLeft = Math.max(0, sim.phaseLeft);
    s.round = sim.round;
    s.loop = sim.loop;
    s.loopTime = sim.loopTime;
    s.meter = sim.meter;
    s.capture = sim.capture;
    s.wins0 = sim.roundWins[0];
    s.wins1 = sim.roundWins[1];
    s.lastRoundWinner = sim.lastRoundWinner;
    s.matchWinner = sim.matchWinner;
    s.endReason = sim.endReason;
    s.paused = sim.paused;
    let pauseLeft = 0;
    for (const d of this.reconnectDeadline.values()) pauseLeft = Math.max(pauseLeft, (d - Date.now()) / 1000);
    s.pauseLeft = pauseLeft;
    s.serverTime = Date.now() - this.started;

    for (const p of sim.players.values()) {
      const ps = s.players.get(p.id);
      if (!ps) continue;
      ps.name = p.name;
      ps.side = p.side;
      ps.ready = p.ready;
      ps.connected = p.connected;
      ps.ping = p.ping;
      ps.kills = p.kills;
      ps.deaths = p.deaths;
      ps.erased = p.erased;
      ps.rescued = p.rescued;
      ps.ammo = p.ammo;
      ps.reloading = p.reloadEnd > 0;
      ps.unitId = p.unitId ?? "";
      ps.respawnIn = p.respawnAt !== null ? Math.max(0, p.respawnAt - sim.loopTime) : 0;
      ps.lastSeq = p.lastSeq;
    }

    for (const key of [...s.units.keys()]) if (!sim.units.has(key)) s.units.delete(key);
    for (const u of sim.units.values()) {
      let us = s.units.get(u.id);
      if (!us) {
        us = new UnitState();
        us.id = u.id;
        us.side = u.side;
        us.owner = u.ownerId;
        us.name = u.ownerName;
        us.loop = u.loop;
        s.units.set(u.id, us);
      }
      us.kind = u.kind;
      us.x = u.move.x;
      us.y = u.move.y;
      us.z = u.move.z;
      us.vx = u.move.vx;
      us.vy = u.move.vy;
      us.vz = u.move.vz;
      us.ground = u.move.onGround;
      us.yaw = u.yaw;
      us.pitch = u.pitch;
      us.crouch = u.move.crouching;
      us.ads = u.ads;
      us.sprint = u.sprint;
      us.speed = u.speed;
      us.hp = Math.round(u.hp);
      us.prot = u.kind === "live" && sim.loopTime < u.protUntil;
    }
  }
}

export const tickRate = TICK_RATE;
