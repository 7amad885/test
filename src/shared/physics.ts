// Deterministic movement + raycasting used identically by the authoritative
// server and by client-side prediction.

import {
  ADS_SPEED,
  AIR_ACCEL,
  CROUCH_EYE,
  CROUCH_HEIGHT,
  CROUCH_SPEED,
  FRICTION,
  GRAVITY,
  GROUND_ACCEL,
  JUMP_VELOCITY,
  PLAYER_RADIUS,
  SPRINT_SPEED,
  STAND_EYE,
  STAND_HEIGHT,
  STEP_HEIGHT,
  WALK_SPEED,
} from "./constants";
import { BOXES, type Box } from "./map";

export interface MoveState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  onGround: boolean;
  crouching: boolean;
}

export interface MoveInput {
  /** strafe (-1 left … 1 right) */
  mx: number;
  /** forward (-1 back … 1 forward) */
  mz: number;
  yaw: number;
  jump: boolean;
  sprint: boolean;
  crouch: boolean;
  ads: boolean;
}

export const newMoveState = (x: number, y: number, z: number): MoveState => ({
  x,
  y,
  z,
  vx: 0,
  vy: 0,
  vz: 0,
  onGround: true,
  crouching: false,
});

const EPS = 1e-4;

export const heightOf = (crouching: boolean) => (crouching ? CROUCH_HEIGHT : STAND_HEIGHT);
export const eyeOf = (crouching: boolean) => (crouching ? CROUCH_EYE : STAND_EYE);

function overlaps(x: number, y: number, z: number, h: number, b: Box): boolean {
  const r = PLAYER_RADIUS;
  return (
    x + r > b.min[0] + EPS &&
    x - r < b.max[0] - EPS &&
    z + r > b.min[2] + EPS &&
    z - r < b.max[2] - EPS &&
    y + h > b.min[1] + EPS &&
    y < b.max[1] - EPS
  );
}

export function spaceFree(x: number, y: number, z: number, h: number, boxes: Box[] = BOXES): boolean {
  if (y < -EPS) return false;
  for (const b of boxes) if (overlaps(x, y, z, h, b)) return false;
  return true;
}

/** True when the movement intent qualifies as sprinting. */
export function isSprinting(input: MoveInput, state: MoveState): boolean {
  return input.sprint && input.mz > 0.3 && !input.ads && !state.crouching;
}

export function moveSpeed(input: MoveInput, state: MoveState): number {
  if (state.crouching) return CROUCH_SPEED;
  if (input.ads) return ADS_SPEED;
  if (isSprinting(input, state)) return SPRINT_SPEED;
  return WALK_SPEED;
}

function approach(v: number, target: number, maxDelta: number): number {
  const d = target - v;
  if (Math.abs(d) <= maxDelta) return target;
  return v + Math.sign(d) * maxDelta;
}

function resolveHorizontal(s: MoveState, axis: 0 | 2, delta: number, wasGround: boolean, boxes: Box[]) {
  if (delta === 0) return;
  const h = heightOf(s.crouching);
  if (axis === 0) s.x += delta;
  else s.z += delta;
  for (const b of boxes) {
    if (!overlaps(s.x, s.y, s.z, h, b)) continue;
    // Try stepping up onto low obstacles (stairs, platform edges).
    const rise = b.max[1] - s.y;
    if (wasGround && rise > 0 && rise <= STEP_HEIGHT && spaceFree(s.x, b.max[1], s.z, h, boxes)) {
      s.y = b.max[1];
      continue;
    }
    const r = PLAYER_RADIUS;
    if (axis === 0) {
      s.x = delta > 0 ? b.min[0] - r : b.max[0] + r;
      s.vx = 0;
    } else {
      s.z = delta > 0 ? b.min[2] - r : b.max[2] + r;
      s.vz = 0;
    }
  }
}

/** Advance one movement step. Mutates and returns `s`. */
export function stepMove(s: MoveState, input: MoveInput, dt: number, boxes: Box[] = BOXES): MoveState {
  // Crouch (standing up needs head room)
  if (input.crouch && !s.crouching) s.crouching = true;
  else if (!input.crouch && s.crouching && spaceFree(s.x, s.y, s.z, STAND_HEIGHT, boxes)) s.crouching = false;

  let mx = Math.max(-1, Math.min(1, input.mx || 0));
  let mz = Math.max(-1, Math.min(1, input.mz || 0));
  const len = Math.hypot(mx, mz);
  if (len > 1) {
    mx /= len;
    mz /= len;
  }
  const sin = Math.sin(input.yaw);
  const cos = Math.cos(input.yaw);
  // forward = (-sin, -cos), right = (cos, -sin)
  const wx = cos * mx - sin * mz;
  const wz = -sin * mx - cos * mz;
  const speed = moveSpeed(input, s);
  const tx = wx * speed;
  const tz = wz * speed;

  if (s.onGround) {
    const accel = (len > 0.01 ? GROUND_ACCEL : FRICTION * WALK_SPEED) * dt;
    s.vx = approach(s.vx, tx, accel);
    s.vz = approach(s.vz, tz, accel);
  } else {
    s.vx = approach(s.vx, tx, AIR_ACCEL * dt);
    s.vz = approach(s.vz, tz, AIR_ACCEL * dt);
  }

  if (input.jump && s.onGround) {
    if (s.crouching && spaceFree(s.x, s.y, s.z, STAND_HEIGHT, boxes)) s.crouching = false;
    if (!s.crouching) {
      s.vy = JUMP_VELOCITY;
      s.onGround = false;
    }
  }

  const wasGround = s.onGround;
  s.vy -= GRAVITY * dt;
  if (s.vy < -40) s.vy = -40;

  resolveHorizontal(s, 0, s.vx * dt, wasGround, boxes);
  resolveHorizontal(s, 2, s.vz * dt, wasGround, boxes);

  // Vertical
  const h = heightOf(s.crouching);
  s.y += s.vy * dt;
  s.onGround = false;
  if (s.y <= 0) {
    s.y = 0;
    if (s.vy < 0) s.vy = 0;
    s.onGround = true;
  }
  for (const b of boxes) {
    if (!overlaps(s.x, s.y, s.z, h, b)) continue;
    if (s.vy <= 0) {
      s.y = b.max[1];
      s.vy = 0;
      s.onGround = true;
    } else {
      s.y = b.min[1] - h;
      s.vy = 0;
    }
  }
  // Stick to ground when walking down small steps so stairs feel smooth.
  if (!s.onGround && wasGround && s.vy <= 0) {
    let top = 0;
    for (const b of boxes) {
      if (
        s.x + PLAYER_RADIUS > b.min[0] + EPS &&
        s.x - PLAYER_RADIUS < b.max[0] - EPS &&
        s.z + PLAYER_RADIUS > b.min[2] + EPS &&
        s.z - PLAYER_RADIUS < b.max[2] - EPS &&
        b.max[1] <= s.y + EPS &&
        b.max[1] > top
      )
        top = b.max[1];
    }
    if (s.y - top <= STEP_HEIGHT + 0.001) {
      s.y = top;
      s.vy = 0;
      s.onGround = true;
    }
  }
  return s;
}

// ---------------------------------------------------------------------------
// Raycasting
// ---------------------------------------------------------------------------

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface RayHit {
  t: number;
  nx: number;
  ny: number;
  nz: number;
}

export function rayAabb(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
  maxT: number,
): RayHit | null {
  let tmin = 0;
  let tmax = maxT;
  let nx = 0,
    ny = 0,
    nz = 0;
  const o = [ox, oy, oz];
  const d = [dx, dy, dz];
  const mn = [minX, minY, minZ];
  const mx = [maxX, maxY, maxZ];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < mn[i] || o[i] > mx[i]) return null;
      continue;
    }
    const inv = 1 / d[i];
    let t1 = (mn[i] - o[i]) * inv;
    let t2 = (mx[i] - o[i]) * inv;
    let sign = -1;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
      sign = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      nx = i === 0 ? sign : 0;
      ny = i === 1 ? sign : 0;
      nz = i === 2 ? sign : 0;
    }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  return { t: tmin, nx, ny, nz };
}

/** Nearest world (static geometry incl. floor) intersection along a normalised ray. */
export function raycastWorld(o: Vec3, d: Vec3, maxT: number, boxes: Box[] = BOXES): RayHit {
  let best: RayHit = { t: maxT, nx: 0, ny: 0, nz: 0 };
  if (d.y < -1e-6) {
    const tf = -o.y / d.y;
    if (tf >= 0 && tf < best.t) best = { t: tf, nx: 0, ny: 1, nz: 0 };
  }
  for (const b of boxes) {
    const h = rayAabb(o.x, o.y, o.z, d.x, d.y, d.z, b.min[0], b.min[1], b.min[2], b.max[0], b.max[1], b.max[2], best.t);
    if (h && h.t < best.t) best = h;
  }
  return best;
}

export interface HitboxPose {
  x: number;
  y: number;
  z: number;
  crouch: boolean;
}

export const BODY_HALF = 0.3;
export const HEAD_HALF = 0.16;

/** Ray vs. a character's head + body boxes. Returns distance and whether the head was hit. */
export function rayCharacter(o: Vec3, d: Vec3, p: HitboxPose, maxT: number): { t: number; head: boolean } | null {
  const eye = eyeOf(p.crouch);
  const bodyTop = eye - HEAD_HALF - 0.01;
  const head = rayAabb(
    o.x,
    o.y,
    o.z,
    d.x,
    d.y,
    d.z,
    p.x - HEAD_HALF,
    p.y + eye - HEAD_HALF,
    p.z - HEAD_HALF,
    p.x + HEAD_HALF,
    p.y + eye + HEAD_HALF,
    p.z + HEAD_HALF,
    maxT,
  );
  const body = rayAabb(
    o.x,
    o.y,
    o.z,
    d.x,
    d.y,
    d.z,
    p.x - BODY_HALF,
    p.y,
    p.z - BODY_HALF,
    p.x + BODY_HALF,
    p.y + bodyTop,
    p.z + BODY_HALF,
    maxT,
  );
  if (head && (!body || head.t <= body.t)) return { t: head.t, head: true };
  if (body) return { t: body.t, head: false };
  return null;
}

export function dirFromAngles(yaw: number, pitch: number): Vec3 {
  const cp = Math.cos(pitch);
  return { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
}

export function angleBetween(a: Vec3, b: Vec3): number {
  const dot = a.x * b.x + a.y * b.y + a.z * b.z;
  return Math.acos(Math.max(-1, Math.min(1, dot)));
}

/** Line of sight between two points against static geometry. */
export function hasLineOfSight(a: Vec3, b: Vec3, boxes: Box[] = BOXES): boolean {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    dz = b.z - a.z;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-6) return true;
  const hit = raycastWorld(a, { x: dx / len, y: dy / len, z: dz / len }, len, boxes);
  return hit.t >= len - 1e-3;
}
