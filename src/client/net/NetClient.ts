// Colyseus connection: matchmaking (create / join by invite code / reconnect),
// clock sync, latency measurement and snapshot buffering for interpolation.

import { Client, type Room } from "colyseus.js";
import { ROOM_NAME } from "../../shared/constants";
import type { FireMsg, InputMsg, ServerEvent } from "../../shared/protocol";

export interface UnitSnap {
  t: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  crouch: boolean;
  ads: boolean;
  sprint: boolean;
  speed: number;
  hp: number;
  kind: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export type RoomState = any;

export function resolveServerUrl(): string {
  const params = new URLSearchParams(location.search);
  const q = params.get("server");
  if (q) return q;
  const env = (import.meta as any).env?.VITE_SERVER_URL as string | undefined;
  if (env) return env;
  if ((import.meta as any).env?.DEV && location.port === "5173") return `${location.protocol}//${location.hostname}:2567`;
  return `${location.protocol}//${location.host}`;
}

type Listener = (e: ServerEvent) => void;

const TOKEN_KEY = "paradox-point:reconnect";

export class NetClient {
  client: Client;
  room: Room<RoomState> | null = null;
  me = "";
  code = "";
  rtt = 0;
  connected = false;
  reconnecting = false;
  /** serverTime(ms) - performance.now() */
  timeOffset: number | null = null;
  snaps = new Map<string, UnitSnap[]>();
  lastPatchAt = 0;
  private listeners = new Set<Listener>();
  private stateListeners = new Set<() => void>();
  private pingTimer: number | null = null;
  private intentionalLeave = false;

  constructor(url = resolveServerUrl()) {
    this.client = new Client(url);
  }

  /** Room state, or null until the first full state (incl. collections) is decoded. */
  get state(): RoomState | null {
    const s = this.room?.state;
    return s && s.players && s.units ? s : null;
  }

  onEvent(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onState(fn: () => void) {
    this.stateListeners.add(fn);
    return () => this.stateListeners.delete(fn);
  }

  async create(name: string, device: string) {
    const room = await this.client.create<RoomState>(ROOM_NAME, { name, device });
    this.attach(room);
    return room;
  }

  async join(code: string, name: string, device: string) {
    const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const saved = this.savedToken(clean);
    if (saved) {
      try {
        const room = await this.client.reconnect<RoomState>(saved);
        this.attach(room);
        return room;
      } catch {
        this.clearToken();
      }
    }
    const room = await this.client.joinById<RoomState>(clean, { name, device });
    this.attach(room);
    return room;
  }

  /** Try to resume a session after a refresh (same tab). */
  async resume(code: string): Promise<boolean> {
    const saved = this.savedToken(code);
    if (!saved) return false;
    try {
      const room = await this.client.reconnect<RoomState>(saved);
      this.attach(room);
      return true;
    } catch {
      this.clearToken();
      return false;
    }
  }

  private savedToken(code: string): string | null {
    try {
      const raw = sessionStorage.getItem(TOKEN_KEY);
      if (!raw) return null;
      const v = JSON.parse(raw);
      return v.code === code ? v.token : null;
    } catch {
      return null;
    }
  }

  private saveToken() {
    if (!this.room) return;
    sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ code: this.code, token: this.room.reconnectionToken }));
  }

  private clearToken() {
    sessionStorage.removeItem(TOKEN_KEY);
  }

  private attach(room: Room<RoomState>) {
    this.room = room;
    this.me = room.sessionId;
    this.code = room.roomId;
    this.connected = true;
    this.reconnecting = false;
    this.intentionalLeave = false;
    this.saveToken();

    room.onStateChange(() => this.handlePatch());
    room.onMessage("ev", (list: ServerEvent[]) => {
      for (const e of list) for (const fn of this.listeners) fn(e);
    });
    room.onMessage("pong", (m: { c: number }) => {
      const sample = performance.now() - m.c;
      this.rtt = this.rtt ? this.rtt * 0.7 + sample * 0.3 : sample;
    });
    room.onLeave((code) => {
      this.connected = false;
      if (this.intentionalLeave || code === 1000 || code === 4000) {
        for (const fn of this.stateListeners) fn();
        return;
      }
      void this.autoReconnect();
    });
    room.onError(() => {
      /* surfaced through onLeave */
    });
    this.startPing();
  }

  private async autoReconnect() {
    if (!this.room || this.reconnecting) return;
    this.reconnecting = true;
    for (const fn of this.stateListeners) fn();
    const token = this.room.reconnectionToken;
    const deadline = performance.now() + 44000;
    let delay = 500;
    while (performance.now() < deadline && !this.intentionalLeave) {
      try {
        const room = await this.client.reconnect<RoomState>(token);
        this.attach(room);
        for (const fn of this.stateListeners) fn();
        return;
      } catch {
        await new Promise((r) => setTimeout(r, delay));
        delay = Math.min(delay * 1.6, 4000);
      }
    }
    this.reconnecting = false;
    for (const fn of this.stateListeners) fn();
  }

  private startPing() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    const ping = () => this.room?.connection.isOpen && this.room.send("ping", { c: performance.now(), rtt: this.rtt });
    ping();
    this.pingTimer = window.setInterval(ping, 1500);
  }

  private handlePatch() {
    const s = this.state;
    if (!s) return;
    const now = performance.now();
    this.lastPatchAt = now;
    const sample = s.serverTime - now;
    if (this.timeOffset === null || Math.abs(sample - this.timeOffset) > 1000) this.timeOffset = sample;
    else this.timeOffset += (sample - this.timeOffset) * 0.06;

    const t = s.serverTime as number;
    const seen = new Set<string>();
    s.units.forEach((u: any, id: string) => {
      seen.add(id);
      let arr = this.snaps.get(id);
      if (!arr) {
        arr = [];
        this.snaps.set(id, arr);
      }
      const last = arr[arr.length - 1];
      if (last && last.t >= t) return;
      arr.push({
        t,
        x: u.x,
        y: u.y,
        z: u.z,
        yaw: u.yaw,
        pitch: u.pitch,
        crouch: u.crouch,
        ads: u.ads,
        sprint: u.sprint,
        speed: u.speed,
        hp: u.hp,
        kind: u.kind,
      });
      if (arr.length > 40) arr.splice(0, arr.length - 40);
    });
    for (const id of [...this.snaps.keys()]) if (!seen.has(id)) this.snaps.delete(id);
    for (const fn of this.stateListeners) fn();
  }

  /** Estimated current server time in ms. */
  serverNow(): number {
    return performance.now() + (this.timeOffset ?? 0);
  }

  /** Interpolated snapshot for a remote unit at the given server time. */
  sample(id: string, t: number, out: UnitSnap): boolean {
    const arr = this.snaps.get(id);
    if (!arr || !arr.length) return false;
    if (t <= arr[0].t) {
      Object.assign(out, arr[0]);
      return true;
    }
    const last = arr[arr.length - 1];
    if (t >= last.t) {
      Object.assign(out, last);
      return true;
    }
    let i = arr.length - 1;
    while (i > 0 && arr[i - 1].t > t) i--;
    const a = arr[i - 1],
      b = arr[i];
    const k = (t - a.t) / Math.max(1, b.t - a.t);
    out.t = t;
    out.x = a.x + (b.x - a.x) * k;
    out.y = a.y + (b.y - a.y) * k;
    out.z = a.z + (b.z - a.z) * k;
    let dy = b.yaw - a.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    out.yaw = a.yaw + dy * k;
    out.pitch = a.pitch + (b.pitch - a.pitch) * k;
    out.crouch = k < 0.5 ? a.crouch : b.crouch;
    out.ads = b.ads;
    out.sprint = b.sprint;
    out.speed = a.speed + (b.speed - a.speed) * k;
    out.hp = b.hp;
    out.kind = b.kind;
    return true;
  }

  sendInputs(batch: InputMsg[]) {
    if (this.room?.connection.isOpen && batch.length) this.room.send("input", batch.length === 1 ? batch[0] : batch);
  }

  fire(m: FireMsg) {
    if (this.room?.connection.isOpen) this.room.send("fire", m);
  }

  reload() {
    if (this.room?.connection.isOpen) this.room.send("reload");
  }

  setReady(ready: boolean) {
    if (this.room?.connection.isOpen) this.room.send("ready", { ready });
  }

  async leave() {
    this.intentionalLeave = true;
    this.clearToken();
    if (this.pingTimer) clearInterval(this.pingTimer);
    try {
      await this.room?.leave(true);
    } catch {
      /* ignore */
    }
    this.room = null;
    this.connected = false;
    this.snaps.clear();
  }
}

export const net = new NetClient();
