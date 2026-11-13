// Arena layout: "Meridian Chronoport", a point-symmetric futuristic arena.
// Every collision box here is shared by the server (movement/hitscan authority)
// and the client (prediction + visual construction), so what you see is exactly
// what you collide with and what blocks bullets.

export type Material = "concrete" | "metal" | "darkmetal" | "glass" | "crate" | "platform";

export interface Box {
  min: [number, number, number];
  max: [number, number, number];
  mat: Material;
  /** Optional visual hint (stairs, pillar, railing …). */
  tag?: string;
}

export interface SpawnPoint {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

const B = (
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  mat: Material,
  tag?: string,
): Box => ({ min: [x0, y0, z0], max: [x1, y1, z1], mat, tag });

/** Point reflection through the origin (x,z) -> (-x,-z): makes the map perfectly fair. */
const mirror = (b: Box): Box => ({
  min: [-b.max[0], b.min[1], -b.max[2]],
  max: [-b.min[0], b.max[1], -b.min[2]],
  mat: b.mat,
  tag: b.tag,
});

export const ARENA = { halfX: 34, halfZ: 22, wallHeight: 9 };

// Half of the arena that belongs to side 0 (CYAN, x < 0); mirrored for side 1.
const HALF: Box[] = [
  // Spawn gate walls (three exits: centre and two flanks)
  B(-27, 0, -9, -26, 3.6, -3, "darkmetal", "gate"),
  B(-27, 0, 3, -26, 3.6, 9, "darkmetal", "gate"),
  B(-27, 0, -22, -26, 3.6, -14, "darkmetal", "gate"),
  B(-27, 0, 14, -26, 3.6, 22, "darkmetal", "gate"),

  // Elevated north deck with stairs descending toward the centre
  B(-22, 0, 15, -12, 2.6, 22, "concrete", "deck"),
  B(-12, 0, 16.5, -11, 2.15, 20.5, "metal", "stair"),
  B(-11, 0, 16.5, -10, 1.7, 20.5, "metal", "stair"),
  B(-10, 0, 16.5, -9, 1.25, 20.5, "metal", "stair"),
  B(-9, 0, 16.5, -8, 0.8, 20.5, "metal", "stair"),
  B(-8, 0, 16.5, -7, 0.4, 20.5, "metal", "stair"),
  B(-22, 2.6, 14.85, -13, 3.62, 15.15, "glass", "railing"),
  B(-20, 2.6, 18, -18.5, 3.8, 19.5, "crate"),

  // Pillars framing the Paradox Point
  B(-5.6, 0, 5.0, -4.4, 7, 6.2, "metal", "pillar"),
  B(-5.6, 0, -6.2, -4.4, 7, -5.0, "metal", "pillar"),
  // Low cover facing the point
  B(-9, 0, -2.2, -8.2, 1.15, 2.2, "concrete", "lowwall"),

  // Mid-lane bulkheads
  B(-16, 0, -9, -15, 3.4, -4, "concrete", "bulkhead"),
  B(-16, 0, 5, -15, 3.4, 9, "concrete", "bulkhead"),

  // Crates and energy glass
  B(-3.2, 0, 9.5, -1.2, 1.3, 11.5, "crate"),
  B(-12, 0, 1.5, -10.5, 1.6, 3, "crate"),
  B(-13.5, 0, -17, -11.5, 2.0, -15, "crate"),
  B(-6, 0, 15, -2, 3, 15.3, "glass", "barrier"),

  // South lane
  B(-20, 0, -12.2, -13, 1.2, -11.6, "concrete", "lowwall"),
  B(-25, 0, -18, -21, 5, -14, "darkmetal", "generator"),
];

const SHARED: Box[] = [
  // The Paradox Point platform
  B(-4.8, 0, -4.8, 4.8, 0.45, 4.8, "platform", "point"),
  // Perimeter walls
  B(-35, 0, -23, 35, ARENA.wallHeight, -22, "concrete", "outer"),
  B(-35, 0, 22, 35, ARENA.wallHeight, 23, "concrete", "outer"),
  B(-35, 0, -22, -34, ARENA.wallHeight, 22, "concrete", "outer"),
  B(34, 0, -22, 35, ARENA.wallHeight, 22, "concrete", "outer"),
];

export const BOXES: Box[] = [...SHARED, ...HALF, ...HALF.map(mirror)];

const SPAWNS_0: SpawnPoint[] = [
  { x: -31, y: 0, z: 0, yaw: -Math.PI / 2 },
  { x: -31, y: 0, z: -6, yaw: -Math.PI / 2 },
  { x: -31, y: 0, z: 6, yaw: -Math.PI / 2 },
  { x: -30.5, y: 0, z: -11.5, yaw: -Math.PI / 2 },
  { x: -30.5, y: 0, z: 11.5, yaw: -Math.PI / 2 },
];

export const SPAWNS: [SpawnPoint[], SpawnPoint[]] = [
  SPAWNS_0,
  SPAWNS_0.map((s) => ({ x: -s.x, y: s.y, z: -s.z, yaw: -s.yaw })),
];

export const POINT_CENTER = { x: 0, y: 0.45, z: 0 };
