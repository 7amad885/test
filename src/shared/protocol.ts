// Client <-> server message contracts.

/** One fixed-step input sample (client sends ~30/s). */
export interface InputMsg {
  seq: number;
  dt: number;
  mx: number;
  mz: number;
  yaw: number;
  pitch: number;
  jump: boolean;
  sprint: boolean;
  crouch: boolean;
  ads: boolean;
}

export interface FireMsg {
  /** Normalised shot direction (includes client-side spread/recoil). */
  dx: number;
  dy: number;
  dz: number;
  yaw: number;
  pitch: number;
  /** Requested lag compensation in ms (server clamps it). */
  rewind: number;
  /** Client shot id, echoed back so the shooter can match confirmations. */
  id: number;
}

/** Broadcast whenever any unit (player, clone, anomaly) fires. */
export interface ShotEvent {
  u: string; // shooter unit id
  side: number;
  o: [number, number, number]; // origin
  d: [number, number, number]; // direction
  e: number; // distance travelled
  h: string | null; // unit hit
  hd: boolean; // headshot
  n: [number, number, number] | null; // world normal when hitting geometry
  id: number; // client shot id (live shots) or -1
  replay: boolean; // fired by a historical clone
}

export interface HitEvent {
  target: string;
  targetOwner: string;
  shooter: string;
  shooterOwner: string;
  dmg: number;
  head: boolean;
  from: [number, number, number];
  hp: number;
}

export interface KillEvent {
  victim: string;
  victimKind: string;
  victimSide: number;
  victimName: string;
  killer: string;
  killerSide: number;
  killerName: string;
  head: boolean;
  pos: [number, number, number];
}

export type ParadoxType = "erased" | "rescued" | "fulfilled";

export interface ParadoxEvent {
  type: ParadoxType;
  unit: string;
  side: number;
  ownerName: string;
  loop: number;
  pos: [number, number, number];
}

export interface PhaseEvent {
  phase: string;
  round: number;
  loop: number;
  winner?: number;
}

export type ServerEvent =
  | { type: "shot"; data: ShotEvent }
  | { type: "hit"; data: HitEvent }
  | { type: "kill"; data: KillEvent }
  | { type: "paradox"; data: ParadoxEvent }
  | { type: "phase"; data: PhaseEvent };
