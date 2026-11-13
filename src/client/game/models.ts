// Procedural hard-surface models: the VX-9 rifle and the armored operator.
// Geometry is built once and shared; materials are applied per instance.

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

export type MatKey = "metal" | "polymer" | "accent" | "glass" | "dark" | "armor" | "fabric" | "visor" | "skin";

export interface Part {
  geo: THREE.BufferGeometry;
  mat: MatKey;
}

/** Extrude a side profile (s = forward, t = up) to thickness `w`; result points down -Z. */
function side(points: [number, number][], w: number, bevel = 0.003): THREE.BufferGeometry {
  const shape = new THREE.Shape(points.map(([s, t]) => new THREE.Vector2(s, t)));
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: w - bevel * 2,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 8,
  });
  g.translate(0, 0, -(w - bevel * 2) / 2);
  g.rotateY(Math.PI / 2);
  return g;
}

function box(w: number, h: number, d: number, x: number, y: number, z: number, r = 0): THREE.BufferGeometry {
  const g = r > 0 ? new RoundedBoxGeometry(w, h, d, 2, r) : new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

/** Cylinder along the -Z axis from s0 to s1 (forward distances). */
function tube(r: number, s0: number, s1: number, y: number, x = 0, seg = 16, r2 = r): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r2, r, s1 - s0, seg);
  g.rotateX(Math.PI / 2);
  g.translate(x, y, -(s0 + s1) / 2);
  return g;
}

function mergeParts(parts: Part[]): Part[] {
  const by = new Map<MatKey, THREE.BufferGeometry[]>();
  for (const p of parts) {
    const g = p.geo.index ? p.geo.toNonIndexed() : p.geo;
    // normalise attribute set for merging
    for (const k of Object.keys(g.attributes)) if (!["position", "normal", "uv"].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array((g.attributes.position.count || 0) * 2), 2));
    (by.get(p.mat) || by.set(p.mat, []).get(p.mat)!).push(g);
  }
  return [...by.entries()].map(([mat, list]) => ({ mat, geo: mergeGeometries(list, false)! }));
}

export interface RifleModel {
  body: Part[];
  mag: Part[];
  /** local anchor points (forward = -Z) */
  muzzle: THREE.Vector3;
  ejection: THREE.Vector3;
  sight: THREE.Vector3;
  magPivot: THREE.Vector3;
  charging: Part[];
  reticle: THREE.Vector3;
}

const rifleCache = new Map<string, RifleModel>();

export function buildRifle(lite = false): RifleModel {
  const key = lite ? "lite" : "full";
  const hit = rifleCache.get(key);
  if (hit) return hit;
  const P: Part[] = [];
  const add = (geo: THREE.BufferGeometry, mat: MatKey) => P.push({ geo, mat });

  // upper receiver with chamfered top
  add(
    side(
      [
        [0.22, -0.006],
        [0.53, -0.006],
        [0.53, 0.036],
        [0.515, 0.046],
        [0.235, 0.046],
        [0.22, 0.034],
      ],
      0.046,
    ),
    "metal",
  );
  // lower receiver + magwell + trigger guard bulk
  add(
    side(
      [
        [0.24, -0.006],
        [0.47, -0.006],
        [0.475, -0.03],
        [0.468, -0.078],
        [0.405, -0.078],
        [0.4, -0.05],
        [0.34, -0.05],
        [0.33, -0.062],
        [0.27, -0.062],
        [0.25, -0.045],
      ],
      0.042,
    ),
    "metal",
  );
  // pistol grip (polymer, raked)
  add(
    side(
      [
        [0.275, -0.048],
        [0.33, -0.048],
        [0.318, -0.075],
        [0.296, -0.165],
        [0.276, -0.17],
        [0.248, -0.16],
        [0.262, -0.075],
      ],
      0.034,
      0.006,
    ),
    "polymer",
  );
  // stock
  add(
    side(
      [
        [0.25, 0.028],
        [0.12, 0.036],
        [0.01, 0.044],
        [-0.005, 0.03],
        [-0.005, -0.075],
        [0.025, -0.09],
        [0.07, -0.088],
        [0.14, -0.04],
        [0.25, -0.03],
      ],
      0.04,
      0.006,
    ),
    "polymer",
  );
  if (!lite) {
    add(box(0.044, 0.012, 0.11, 0, -0.07, 0.04, 0.004), "dark"); // butt pad
    add(tube(0.016, 0.12, 0.26, 0.008), "metal"); // buffer tube
  }
  // handguard: octagonal prism with accent energy cell
  add(tube(0.032, 0.52, 0.82, 0.012, 0, 8), "polymer");
  add(box(0.006, 0.012, 0.22, 0.031, 0.006, -0.66), "accent");
  add(box(0.006, 0.012, 0.22, -0.031, 0.006, -0.66), "accent");
  if (!lite) {
    for (let i = 0; i < 5; i++) {
      add(box(0.008, 0.01, 0.026, 0.031, 0.026, -(0.56 + i * 0.05), 0.002), "dark");
      add(box(0.008, 0.01, 0.026, -0.031, 0.026, -(0.56 + i * 0.05), 0.002), "dark");
      add(box(0.024, 0.008, 0.026, 0, -0.019, -(0.56 + i * 0.05), 0.002), "dark");
    }
  }
  // barrel, gas block, muzzle brake
  add(tube(0.0095, 0.8, 0.92, 0.012, 0, 12), "metal");
  add(box(0.03, 0.032, 0.03, 0, 0.012, -0.83, 0.004), "metal");
  add(tube(0.016, 0.9, 0.975, 0.012, 0, 12), "dark");
  if (!lite) for (let i = 0; i < 3; i++) add(box(0.034, 0.006, 0.008, 0, 0.012, -(0.92 + i * 0.016)), "metal");
  // top rail and teeth
  add(box(0.024, 0.008, 0.56, 0, 0.05, -0.52), "dark");
  if (!lite) for (let s = 0.25; s < 0.8; s += 0.012) add(box(0.026, 0.005, 0.005, 0, 0.0565, -s), "dark");
  // holographic optic
  add(box(0.034, 0.014, 0.1, 0, 0.065, -0.355, 0.003), "dark");
  add(box(0.005, 0.048, 0.1, 0.019, 0.093, -0.355, 0.002), "metal");
  add(box(0.005, 0.048, 0.1, -0.019, 0.093, -0.355, 0.002), "metal");
  add(box(0.043, 0.006, 0.1, 0, 0.118, -0.355, 0.002), "metal");
  add(box(0.034, 0.04, 0.003, 0, 0.093, -0.398), "glass");
  if (!lite) add(box(0.012, 0.012, 0.03, 0.026, 0.076, -0.33, 0.003), "polymer"); // sight battery
  // ejection port, forward assist, trigger
  add(box(0.004, 0.016, 0.06, 0.024, 0.02, -0.38), "dark");
  if (!lite) {
    add(box(0.003, 0.03, 0.003, 0, -0.06, -0.335), "metal");
    add(tube(0.008, 0.31, 0.33, 0.032, 0.026, 8), "metal");
  }
  const charging: Part[] = [{ geo: box(0.05, 0.01, 0.022, 0, 0.04, -0.23, 0.003), mat: "metal" }];
  // curved magazine (separate for reload animation), pivot at the magwell
  const magPivot = new THREE.Vector3(0, -0.07, -0.44);
  const magShape = side(
    [
      [0.405, -0.0],
      [0.468, -0.0],
      [0.478, -0.06],
      [0.5, -0.15],
      [0.495, -0.16],
      [0.438, -0.152],
      [0.426, -0.06],
    ],
    0.028,
    0.004,
  );
  magShape.translate(0, -0.072, 0); // seat the magazine top inside the magwell
  const mag: Part[] = [
    { geo: magShape, mat: "polymer" },
    { geo: box(0.03, 0.01, 0.065, 0, -0.232, -0.468, 0.004), mat: "dark" },
  ];
  const model: RifleModel = {
    body: mergeParts(P),
    mag: mergeParts(mag),
    charging: mergeParts(charging),
    muzzle: new THREE.Vector3(0, 0.012, -0.98),
    ejection: new THREE.Vector3(0.026, 0.02, -0.38),
    sight: new THREE.Vector3(0, 0.093, -0.355),
    reticle: new THREE.Vector3(0, 0.093, -0.396),
    magPivot,
  };
  // magazine geometry is authored in gun space; shift it so its origin is the pivot
  for (const m of model.mag) m.geo.translate(-magPivot.x, -magPivot.y, -magPivot.z);
  rifleCache.set(key, model);
  return model;
}

// ---------------------------------------------------------------- hands (first person)

/** Tapered cylinder spanning two points (limb segment). */
function limb(a: [number, number, number], b: [number, number, number], r0: number, r1: number, seg = 14): THREE.BufferGeometry {
  const A = new THREE.Vector3(...a),
    Bv = new THREE.Vector3(...b);
  const len = A.distanceTo(Bv);
  const g = new THREE.CylinderGeometry(r1, r0, len, seg);
  g.translate(0, len / 2, 0); // base at origin, extends +Y
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), Bv.clone().sub(A).normalize());
  g.applyQuaternion(q);
  g.translate(A.x, A.y, A.z);
  return g;
}

export function buildHands(): { right: Part[]; left: Part[] } {
  const finger = (len: number, x: number, y: number, z: number, rx: number, rz = 0) => {
    const g = new THREE.CapsuleGeometry(0.0085, len, 3, 8);
    g.rotateX(rx);
    g.rotateZ(rz);
    g.translate(x, y, z);
    return g;
  };
  // right hand wraps the pistol grip
  const R: Part[] = [];
  R.push({ geo: box(0.05, 0.085, 0.055, 0.0, -0.1, -0.29, 0.016), mat: "fabric" });
  for (let i = 0; i < 4; i++) R.push({ geo: finger(0.028, -0.026, -0.08 - i * 0.021, -0.305, 0, Math.PI / 2), mat: "fabric" });
  R.push({ geo: finger(0.03, 0.022, -0.05, -0.31, 0.6), mat: "fabric" });
  R.push({ geo: finger(0.03, -0.012, -0.045, -0.335, Math.PI / 2 - 0.2), mat: "fabric" }); // trigger finger
  // forearm runs from the wrist down and back, out of frame
  R.push({ geo: limb([0.004, -0.13, -0.27], [0.1, -0.36, 0.02], 0.034, 0.046), mat: "fabric" });
  R.push({ geo: limb([0.03, -0.18, -0.2], [0.075, -0.29, -0.06], 0.045, 0.05), mat: "armor" });
  R.push({ geo: limb([0.032, -0.2, -0.17], [0.05, -0.245, -0.11], 0.0465, 0.0465, 10), mat: "accent" });
  // left hand cups the handguard
  const L: Part[] = [];
  L.push({ geo: box(0.06, 0.04, 0.085, -0.012, -0.03, -0.66, 0.015), mat: "fabric" });
  for (let i = 0; i < 4; i++) L.push({ geo: finger(0.03, 0.03, -0.004 + 0.0, -0.625 - i * 0.022, 0, 0.35), mat: "fabric" });
  L.push({ geo: finger(0.032, -0.036, 0.02, -0.68, 0.3, -0.4), mat: "fabric" });
  L.push({ geo: limb([-0.02, -0.05, -0.65], [-0.2, -0.33, -0.36], 0.034, 0.046), mat: "fabric" });
  L.push({ geo: limb([-0.07, -0.12, -0.57], [-0.15, -0.25, -0.44], 0.045, 0.05), mat: "armor" });
  return { right: mergeParts(R), left: mergeParts(L) };
}

// ---------------------------------------------------------------- operator body

export type Segment =
  | "pelvis"
  | "torso"
  | "head"
  | "upperArmL"
  | "upperArmR"
  | "foreArmL"
  | "foreArmR"
  | "thighL"
  | "thighR"
  | "shinL"
  | "shinR";

export type BodyModel = Record<Segment, Part[]>;

const bodyCache = new Map<string, BodyModel>();

export function buildBody(lod: 0 | 1): BodyModel {
  const key = `b${lod}`;
  const hit = bodyCache.get(key);
  if (hit) return hit;
  const cs = lod === 0 ? 10 : 6; // radial segments
  const capsule = (r: number, len: number, y: number, x = 0, z = 0) => {
    const g = new THREE.CapsuleGeometry(r, len, lod === 0 ? 4 : 2, cs);
    g.translate(x, y, z);
    return g;
  };
  const rb = (w: number, h: number, d: number, x: number, y: number, z: number, r = 0.03) =>
    lod === 0 ? box(w, h, d, x, y, z, r) : box(w, h, d, x, y, z);

  const B: Record<Segment, Part[]> = {
    pelvis: [],
    torso: [],
    head: [],
    upperArmL: [],
    upperArmR: [],
    foreArmL: [],
    foreArmR: [],
    thighL: [],
    thighR: [],
    shinL: [],
    shinR: [],
  };
  // pelvis (origin = hips)
  B.pelvis.push({ geo: rb(0.34, 0.17, 0.22, 0, -0.02, 0), mat: "fabric" });
  B.pelvis.push({ geo: rb(0.36, 0.05, 0.24, 0, 0.06, 0, 0.015), mat: "armor" }); // belt
  B.pelvis.push({ geo: rb(0.08, 0.1, 0.05, 0.12, 0.0, -0.12, 0.015), mat: "armor" }); // pouches
  B.pelvis.push({ geo: rb(0.08, 0.1, 0.05, -0.12, 0.0, -0.12, 0.015), mat: "armor" });
  // torso (origin = spine base, ~hips + 0.1)
  B.torso.push({ geo: capsule(0.14, 0.12, 0.12), mat: "fabric" }); // abdomen
  B.torso.push({ geo: rb(0.44, 0.34, 0.27, 0, 0.36, 0, 0.06), mat: "fabric" }); // chest
  B.torso.push({ geo: rb(0.4, 0.3, 0.07, 0, 0.36, -0.14, 0.03), mat: "armor" }); // front plate
  B.torso.push({ geo: rb(0.38, 0.28, 0.06, 0, 0.36, 0.14, 0.03), mat: "armor" }); // back plate
  B.torso.push({ geo: rb(0.22, 0.03, 0.02, 0, 0.42, -0.18, 0.008), mat: "accent" }); // chest light strip
  B.torso.push({ geo: rb(0.16, 0.15, 0.07, 0, 0.22, -0.15, 0.02), mat: "armor" }); // mag pouches
  B.torso.push({ geo: rb(0.3, 0.38, 0.14, 0, 0.36, 0.22, 0.04), mat: "armor" }); // chrono pack
  B.torso.push({ geo: capsule(0.04, 0.26, 0.38, 0, 0.3), mat: "accent" }); // glowing time core
  B.torso.push({ geo: rb(0.15, 0.1, 0.2, 0.25, 0.5, 0, 0.04), mat: "armor" }); // shoulder pads
  B.torso.push({ geo: rb(0.15, 0.1, 0.2, -0.25, 0.5, 0, 0.04), mat: "armor" });
  B.torso.push({ geo: capsule(0.06, 0.05, 0.56), mat: "fabric" }); // neck
  // head (origin = neck top)
  const helmet = new THREE.SphereGeometry(0.135, lod === 0 ? 20 : 10, lod === 0 ? 14 : 8);
  helmet.scale(1, 1.08, 1.12);
  helmet.translate(0, 0.07, 0.01);
  B.head.push({ geo: helmet, mat: "armor" });
  const visor = new THREE.SphereGeometry(0.128, lod === 0 ? 20 : 10, 8, Math.PI * 1.15, Math.PI * 0.7, Math.PI * 0.32, Math.PI * 0.3);
  visor.scale(1.05, 1.0, 1.15);
  visor.translate(0, 0.06, -0.012);
  B.head.push({ geo: visor, mat: "visor" });
  B.head.push({ geo: rb(0.05, 0.08, 0.09, 0.135, 0.05, 0.01, 0.02), mat: "dark" }); // comms
  B.head.push({ geo: rb(0.05, 0.08, 0.09, -0.135, 0.05, 0.01, 0.02), mat: "dark" });
  B.head.push({ geo: rb(0.02, 0.02, 0.1, 0.15, 0.1, -0.04, 0.006), mat: "accent" });
  // arms (origin = shoulder / elbow), hanging along -Y
  for (const s of ["L", "R"] as const) {
    B[`upperArm${s}`].push({ geo: capsule(0.058, 0.2, -0.13), mat: "fabric" });
    B[`upperArm${s}`].push({ geo: rb(0.13, 0.12, 0.13, 0, -0.05, 0, 0.035), mat: "armor" });
    B[`foreArm${s}`].push({ geo: capsule(0.05, 0.18, -0.12), mat: "fabric" });
    B[`foreArm${s}`].push({ geo: rb(0.11, 0.15, 0.11, 0, -0.12, 0, 0.03), mat: "armor" });
    B[`foreArm${s}`].push({ geo: rb(0.075, 0.09, 0.05, 0, -0.27, 0, 0.02), mat: "dark" }); // glove
    // legs (origin = hip joint / knee)
    B[`thigh${s}`].push({ geo: capsule(0.078, 0.28, -0.2), mat: "fabric" });
    B[`thigh${s}`].push({ geo: rb(0.15, 0.2, 0.12, 0, -0.15, -0.04, 0.03), mat: "armor" });
    B[`shin${s}`].push({ geo: capsule(0.062, 0.28, -0.19), mat: "fabric" });
    B[`shin${s}`].push({ geo: rb(0.12, 0.13, 0.1, 0, -0.02, -0.06, 0.03), mat: "armor" }); // knee pad
    B[`shin${s}`].push({ geo: rb(0.13, 0.11, 0.28, 0, -0.39, -0.04, 0.035), mat: "dark" }); // boot
    B[`shin${s}`].push({ geo: rb(0.1, 0.02, 0.2, 0, -0.32, -0.02, 0.006), mat: "accent" });
  }
  const out = {} as BodyModel;
  for (const k of Object.keys(B) as Segment[]) out[k] = mergeParts(B[k]);
  bodyCache.set(key, out);
  return out;
}

/** Merge every part of a segment into one geometry (single-material holograms). */
export function flatten(parts: Part[]): THREE.BufferGeometry {
  return mergeGeometries(
    parts.map((p) => p.geo),
    false,
  )!;
}
