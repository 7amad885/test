// Shared gameplay constants. Server and client import the same numbers so that
// client-side prediction matches the authoritative server simulation exactly.

export const GAME_NAME = "PARADOX POINT";
export const ROOM_NAME = "duel";

/** Server simulation rate (Hz) and the client's fixed input/prediction step. */
export const TICK_RATE = 30;
export const TICK_DT = 1 / TICK_RATE;
/** State patches sent to clients per second. */
export const PATCH_RATE = 20;

// ---- Match structure -------------------------------------------------------
export const LOOPS_PER_ROUND = 3;
export const ROUNDS_TO_WIN = 3;
/** Seconds of play in every loop. */
export const LOOP_DURATION = 35;
/** Seconds of the rewind transition between loops. */
export const REWIND_DURATION = 3.5;
/** Pre-round freeze/countdown. */
export const COUNTDOWN_DURATION = 3.5;
/** Results screen between rounds. */
export const ROUND_END_DURATION = 6;
/** Seconds a dead live player waits before re-entering the current loop. */
export const RESPAWN_DELAY = 4;
export const SPAWN_PROTECTION = 1.25;
/** How long the server waits for a dropped player before the match is forfeited. */
export const RECONNECT_WINDOW = 45;
/** Maximum life-tracks recorded per player per loop (bounds clone count). */
export const MAX_TRACKS_PER_LOOP = 5;

// ---- Capture point ---------------------------------------------------------
export const POINT_RADIUS = 4.6;
/** Tug-of-war meter: -100 (side 1 wins) … +100 (side 0 wins). */
export const METER_MAX = 100;
/** Meter points per second for one unit holding the point uncontested. */
export const CAPTURE_RATE = 100 / 42;
/** Multiplier by number of friendly units on the point (index = count). */
export const CAPTURE_MULT = [0, 1, 1.5, 2, 2.4, 2.7];

// ---- Player ----------------------------------------------------------------
export const MAX_HP = 100;
export const PLAYER_RADIUS = 0.34;
export const STAND_HEIGHT = 1.8;
export const CROUCH_HEIGHT = 1.2;
export const STAND_EYE = 1.62;
export const CROUCH_EYE = 1.08;
export const WALK_SPEED = 4.7;
export const SPRINT_SPEED = 7.1;
export const CROUCH_SPEED = 2.4;
export const ADS_SPEED = 3.0;
export const GROUND_ACCEL = 55;
export const AIR_ACCEL = 14;
export const FRICTION = 12;
export const GRAVITY = 19;
export const JUMP_VELOCITY = 6.4;
export const STEP_HEIGHT = 0.56;

// ---- Weapon (VX-9 "Chronos" pulse rifle) -----------------------------------
export const RIFLE = {
  name: "VX-9 Chronos",
  magSize: 30,
  rpm: 620,
  reloadTime: 2.05,
  damageBody: 21,
  damageHead: 52,
  range: 120,
  hipSpread: 0.028, // radians (cone half-angle)
  adsSpread: 0.0045,
  moveSpreadAdd: 0.02,
  airSpreadAdd: 0.05,
  crouchSpreadMult: 0.7,
  adsTime: 0.18,
} as const;
export const FIRE_INTERVAL = 60 / RIFLE.rpm;

/** Anomalies (rescued clones) defend their position with weaker automatic fire. */
export const ANOMALY = {
  range: 32,
  fov: (80 * Math.PI) / 180,
  turnRate: Math.PI * 1.1,
  burst: 3,
  burstInterval: 0.11,
  burstPause: 0.95,
  spread: 0.05,
  damage: 13,
  reactionTime: 0.35,
} as const;

/** Maximum lag compensation the server will honour (ms). */
export const MAX_REWIND_MS = 280;
/** Client interpolation delay for remote entities (ms). */
export const INTERP_DELAY_MS = 110;

export type Side = 0 | 1;
export const SIDE_NAMES = ["CYAN", "EMBER"] as const;
export const SIDE_COLORS = ["#2fd8ff", "#ff7a2a"] as const;

export type Phase = "lobby" | "countdown" | "loop" | "rewind" | "roundEnd" | "matchEnd";

/** Unit kinds: the live player, a replaying clone, a rescued clone (anomaly), or an erased clone (ghost). */
export type UnitKind = "live" | "clone" | "anomaly" | "ghost";
