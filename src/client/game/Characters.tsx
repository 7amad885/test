import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { SIDE_COLORS } from "../../shared/constants";
import { flashTexture, labelTexture, surface } from "./textures";
import { buildBody, buildRifle, flatten, type MatKey, type Part, type Segment } from "./models";
import { game, type RenderUnit } from "./runtime";
import { makeHoloMaterial } from "./shaders";

// ---------------------------------------------------------------- materials

type MatSet = Record<MatKey, THREE.Material>;
const liveSets: MatSet[] = [];

function liveMaterials(side: number): MatSet {
  if (liveSets[side]) return liveSets[side];
  const armorTex = surface("armor", 512, 4);
  const col = new THREE.Color(SIDE_COLORS[side]);
  const tint = side === 0 ? new THREE.Color("#c5d3e2") : new THREE.Color("#e2d0c3");
  const set: MatSet = {
    armor: new THREE.MeshStandardMaterial({ color: tint, map: armorTex.map, normalMap: armorTex.normalMap, roughnessMap: armorTex.ormMap, metalnessMap: armorTex.ormMap, roughness: 1, metalness: 0.8 }),
    fabric: new THREE.MeshStandardMaterial({ color: side === 0 ? "#2a323c" : "#3a3029", roughness: 0.92, metalness: 0.05 }),
    dark: new THREE.MeshStandardMaterial({ color: "#16191d", roughness: 0.55, metalness: 0.6 }),
    accent: new THREE.MeshStandardMaterial({ color: "#000", emissive: col, emissiveIntensity: 4, toneMapped: false }),
    visor: new THREE.MeshStandardMaterial({ color: "#05070a", emissive: col, emissiveIntensity: 2.2, roughness: 0.05, metalness: 0.9, toneMapped: false }),
    metal: new THREE.MeshStandardMaterial({ color: "#3a4048", roughness: 0.35, metalness: 0.95 }),
    polymer: new THREE.MeshStandardMaterial({ color: "#1d2024", roughness: 0.7, metalness: 0.1 }),
    glass: new THREE.MeshStandardMaterial({ color: "#88ddff", transparent: true, opacity: 0.3, roughness: 0.05 }),
    skin: new THREE.MeshStandardMaterial({ color: "#8a6a55", roughness: 0.8 }),
  };
  liveSets[side] = set;
  return set;
}

const holoCache = new Map<string, THREE.ShaderMaterial>();
function holo(side: number, mode: number, shared = true): THREE.ShaderMaterial {
  if (!shared) return makeHoloMaterial(SIDE_COLORS[side], mode);
  const k = `${side}:${mode}`;
  let m = holoCache.get(k);
  if (!m) {
    m = makeHoloMaterial(SIDE_COLORS[side], mode);
    holoCache.set(k, m);
  }
  return m;
}

const SEGMENTS: Segment[] = ["pelvis", "torso", "head", "upperArmL", "upperArmR", "foreArmL", "foreArmR", "thighL", "thighR", "shinL", "shinR"];
const DOWN = new THREE.Vector3(0, -1, 0);

// ---------------------------------------------------------------- rig

class OperatorRig {
  root = new THREE.Group();
  hips = new THREE.Group();
  spine = new THREE.Group();
  neck = new THREE.Group();
  aim = new THREE.Group();
  rifle = new THREE.Group();
  joints: Record<Segment, THREE.Group>;
  private liveMeshes: { lod: 0 | 1; mesh: THREE.Mesh; key: MatKey }[] = [];
  private holoMeshes: THREE.Mesh[] = [];
  private mode = -1;
  private side = -1;
  private phase = 0;
  private crouch = 0;
  private sprint = 0;
  private last = new THREE.Vector3();
  private lastY = 0;
  private air = 0;
  private flash: THREE.Mesh;
  private label: THREE.Sprite;
  private labelKey = "";
  private ghostFade = 1;
  private ghostSince = 0;
  ownGhostMat: THREE.ShaderMaterial | null = null;
  private lod: 0 | 1 = 0;

  constructor() {
    const j = {} as Record<Segment, THREE.Group>;
    for (const s of SEGMENTS) j[s] = new THREE.Group();
    this.joints = j;
    this.root.add(this.hips);
    this.hips.position.y = 0.95;
    this.hips.add(j.pelvis, this.spine, j.thighL, j.thighR);
    this.spine.position.y = 0.1;
    this.spine.add(j.torso, this.neck, this.aim);
    this.neck.position.y = 0.6;
    this.neck.add(j.head);
    this.aim.position.y = 0.45;
    this.aim.add(j.upperArmL, j.upperArmR, j.foreArmL, j.foreArmR, this.rifle);
    j.thighL.position.set(-0.11, -0.04, 0);
    j.thighR.position.set(0.11, -0.04, 0);
    j.thighL.add(j.shinL);
    j.thighR.add(j.shinR);
    j.shinL.position.y = -0.42;
    j.shinR.position.y = -0.42;
    this.rifle.position.set(0.12, 0.02, 0.1);

    for (const lod of [0, 1] as const) {
      const body = buildBody(lod);
      for (const s of SEGMENTS)
        for (const p of body[s]) {
          const m = new THREE.Mesh(p.geo);
          m.castShadow = true;
          j[s].add(m);
          this.liveMeshes.push({ lod, mesh: m, key: p.mat });
        }
    }
    const lowBody = buildBody(1);
    for (const s of SEGMENTS) {
      const m = new THREE.Mesh(flatten(lowBody[s]));
      j[s].add(m);
      this.holoMeshes.push(m);
    }
    const rifle = buildRifle(true);
    const addRifle = (parts: Part[]) => {
      for (const p of parts) {
        const m = new THREE.Mesh(p.geo);
        m.castShadow = true;
        this.rifle.add(m);
        this.liveMeshes.push({ lod: 0, mesh: m, key: p.mat });
        const m1 = new THREE.Mesh(p.geo);
        this.rifle.add(m1);
        this.liveMeshes.push({ lod: 1, mesh: m1, key: p.mat });
      }
    };
    addRifle(rifle.body);
    addRifle(rifle.mag);
    const rh = new THREE.Mesh(flatten([...rifle.body, ...rifle.mag]));
    this.rifle.add(rh);
    this.holoMeshes.push(rh);

    const fm = new THREE.MeshBasicMaterial({ map: flashTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, color: new THREE.Color(3, 2.4, 1.6), side: THREE.DoubleSide });
    this.flash = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.4), fm);
    this.flash.position.copy(rifle.muzzle).add(new THREE.Vector3(0, 0, -0.08));
    this.flash.visible = false;
    this.rifle.add(this.flash);

    this.label = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false }));
    this.label.scale.set(1.2, 0.3, 1);
    this.label.position.y = 2.15;
    this.root.add(this.label);
  }

  /** mode: 0 live, 1 clone, 2 anomaly, 3 ghost, 4 rewind */
  private setMode(mode: number, side: number) {
    if (mode === this.mode && side === this.side) return;
    this.mode = mode;
    this.side = side;
    const live = mode === 0;
    if (live) {
      const set = liveMaterials(side);
      for (const l of this.liveMeshes) l.mesh.material = set[l.key];
    } else {
      let mat: THREE.Material;
      if (mode === 3) {
        this.ownGhostMat ??= holo(side, 2, false);
        mat = this.ownGhostMat;
        this.ghostSince = game.now;
      } else mat = holo(side, mode === 1 ? 0 : mode === 2 ? 1 : 3);
      for (const m of this.holoMeshes) m.material = mat;
    }
    this.applyVisibility();
  }

  private applyVisibility() {
    const live = this.mode === 0;
    for (const l of this.liveMeshes) l.mesh.visible = live && l.lod === this.lod;
    for (const m of this.holoMeshes) m.visible = !live;
  }

  private setLabel(u: RenderUnit, mode: number) {
    const mine = u.side === game.side;
    let text = "",
      sub: string | undefined;
    if (mode === 0) text = u.name;
    else if (mode === 1) {
      text = mine ? "YOUR ECHO" : `${u.name.toUpperCase()}'S ECHO`;
      sub = `LOOP ${u.loop}`;
    } else if (mode === 2) {
      text = "ANOMALY";
      sub = mine ? `your rescued L${u.loop} echo` : `${u.name} · L${u.loop}`;
    } else if (mode === 3) {
      text = "ERASED";
      sub = `L${u.loop}`;
    }
    const key = `${text}|${sub}|${u.side}|${mode}`;
    if (key === this.labelKey) return;
    this.labelKey = key;
    const mat = this.label.material as THREE.SpriteMaterial;
    mat.map?.dispose();
    if (!text || mode === 4) {
      this.label.visible = false;
      return;
    }
    mat.map = labelTexture(text, mode === 2 ? "#ffd36b" : mode === 3 ? "#ff8095" : SIDE_COLORS[u.side], sub);
    mat.needsUpdate = true;
    this.label.visible = true;
  }

  update(u: RenderUnit, dt: number, cam: THREE.Camera) {
    const mode = u.rewind ? 4 : u.kind === "live" ? 0 : u.kind === "clone" ? 1 : u.kind === "anomaly" ? 2 : 3;
    this.setMode(mode, u.side);
    this.setLabel(u, mode);
    this.root.visible = true;
    const dist = cam.position.distanceTo(this.root.position);
    const lod: 0 | 1 = dist > 22 ? 1 : 0;
    if (lod !== this.lod) {
      this.lod = lod;
      this.applyVisibility();
    }
    this.label.visible = this.label.visible && dist < 45;

    // ghosts dissolve to a faint, flickering echo of the erased timeline
    if (mode === 3 && this.ownGhostMat) {
      const t = game.now - this.ghostSince;
      this.ghostFade = t < 1.2 ? 1 - (t / 1.2) * 0.7 : 0.22 + 0.12 * Math.abs(Math.sin(t * 9 + this.side));
      this.ownGhostMat.uniforms.uFade.value = this.ghostFade;
    }

    // ---- root transform
    this.root.position.set(u.x, u.y, u.z);
    this.root.rotation.y = u.yaw;
    const moved = this.last.distanceTo(this.root.position);
    const vy = dt > 0 ? (u.y - this.lastY) / dt : 0;
    this.lastY = u.y;
    // movement direction relative to facing for backwards stepping
    const dx = u.x - this.last.x,
      dz = u.z - this.last.z;
    const fwd = -Math.sin(u.yaw) * dx + -Math.cos(u.yaw) * dz;
    this.last.copy(this.root.position);
    const speed = mode === 3 ? 0 : Math.abs(u.speed) > 0.05 ? Math.abs(u.speed) : dt > 0 ? Math.min(8, moved / dt) : 0;
    const amp = Math.min(1.25, speed / 4.7);
    const dir = u.speed < 0 || fwd < -0.001 ? -1 : 1;
    this.phase += dt * speed * 1.9 * dir;
    this.crouch += ((u.crouch ? 1 : 0) - this.crouch) * Math.min(1, dt * 10);
    this.sprint += ((u.sprint ? 1 : 0) - this.sprint) * Math.min(1, dt * 6);
    this.air += ((Math.abs(vy) > 1.5 ? 1 : 0) - this.air) * Math.min(1, dt * 8);
    const c = this.crouch;
    const j = this.joints;
    const sL = Math.sin(this.phase),
      sR = Math.sin(this.phase + Math.PI);
    const swing = 0.55 * amp * (1 - c * 0.5);
    j.thighL.rotation.x = sL * swing + c * 1.3 + this.air * 0.5;
    j.thighR.rotation.x = sR * swing + c * 1.3 + this.air * 0.2;
    j.shinL.rotation.x = -(0.1 + Math.max(0, -Math.cos(this.phase)) * 0.9) * amp - c * 2.0 - this.air * 0.8;
    j.shinR.rotation.x = -(0.1 + Math.max(0, Math.cos(this.phase)) * 0.9) * amp - c * 2.0 - this.air * 0.5;
    this.hips.position.y = 0.95 - c * 0.36 + Math.abs(Math.sin(this.phase)) * 0.04 * amp;
    this.hips.rotation.y = Math.sin(this.phase) * 0.08 * amp;
    this.spine.rotation.y = -this.hips.rotation.y;
    const pitch = mode === 3 ? -0.4 : u.pitch;
    this.spine.rotation.x = pitch * 0.3 - c * 0.15 - this.sprint * 0.18 - (mode === 3 ? 0.3 : 0);
    this.neck.rotation.x = pitch * 0.35;
    this.aim.rotation.x = pitch * 0.7 - this.sprint * 0.7;
    this.aim.rotation.y = this.sprint * 0.5;

    // ---- arms by two-bone IK onto the rifle grip / handguard
    this.rifle.updateMatrix();
    const grip = new THREE.Vector3(0, -0.1, -0.29).applyMatrix4(this.rifle.matrix);
    const guard = new THREE.Vector3(0, -0.025, -0.64).applyMatrix4(this.rifle.matrix);
    this.solveArm(j.upperArmR, j.foreArmR, new THREE.Vector3(0.25, 0.02, 0), grip, new THREE.Vector3(0.6, -0.6, 0.3));
    this.solveArm(j.upperArmL, j.foreArmL, new THREE.Vector3(-0.25, 0.02, 0), guard, new THREE.Vector3(-0.6, -0.8, 0.2));

    // ---- muzzle flash
    const shotAt = game.muzzles.get(u.id) ?? -1;
    const since = game.now - shotAt;
    this.flash.visible = since < 0.05 && mode !== 3;
    if (this.flash.visible) {
      this.flash.rotation.z = Math.random() * Math.PI;
      this.flash.lookAt(cam.position);
    }
  }

  private solveArm(upper: THREE.Group, fore: THREE.Group, S: THREE.Vector3, H: THREE.Vector3, pole: THREE.Vector3) {
    const a = 0.28,
      b = 0.3;
    const toH = H.clone().sub(S);
    const d = Math.min(toH.length(), a + b - 0.005);
    const dirv = toH.normalize();
    const cosA = (a * a + d * d - b * b) / (2 * a * d);
    const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    const u = pole.clone().sub(dirv.clone().multiplyScalar(pole.dot(dirv))).normalize();
    const E = S.clone().addScaledVector(dirv, a * cosA).addScaledVector(u, a * sinA);
    upper.position.copy(S);
    upper.quaternion.setFromUnitVectors(DOWN, E.clone().sub(S).normalize());
    fore.position.copy(E);
    fore.quaternion.setFromUnitVectors(DOWN, S.clone().addScaledVector(dirv, d).sub(E).normalize());
  }

  dispose() {
    (this.label.material as THREE.SpriteMaterial).map?.dispose();
    this.ownGhostMat?.dispose();
  }
}

// ---------------------------------------------------------------- React glue

function Operator({ get }: { get: () => RenderUnit | undefined }) {
  const rig = useMemo(() => new OperatorRig(), []);
  useEffect(() => () => rig.dispose(), [rig]);
  useFrame((state, dt) => {
    const u = get();
    if (!u) {
      rig.root.visible = false;
      return;
    }
    rig.update(u, Math.min(dt, 0.1), state.camera);
  });
  return <primitive object={rig.root} />;
}

/** Death: the body topples and disintegrates into a temporal ghost. */
function DeathBody({ unit, t0 }: { unit: RenderUnit; t0: number }) {
  const rig = useMemo(() => new OperatorRig(), []);
  useEffect(() => () => rig.dispose(), [rig]);
  const frozen = useMemo(() => ({ ...unit, kind: "ghost", speed: 0 }), [unit]);
  useFrame((state, dt) => {
    const t = game.now - t0;
    rig.update(frozen as RenderUnit, dt, state.camera);
    const k = Math.min(1, t / 0.55);
    rig.root.rotation.x = -k * k * 1.35;
    rig.root.position.y = unit.y + Math.sin(k * Math.PI) * 0.15;
    if (rig.ownGhostMat) rig.ownGhostMat.uniforms.uFade.value = Math.max(0, 1 - t / 1.8);
    rig.root.visible = t < 1.8;
  });
  return <primitive object={rig.root} />;
}

export function Characters() {
  const [, force] = useState(0);
  const ver = useRef("");
  useFrame(() => {
    const now = game.now;
    game.deaths = game.deaths.filter((d) => now - d.t0 < 2);
    const key = `${game.unitVersion}|${game.phase === "rewind" ? game.rewindUnits.map((u) => u.id).join(",") : ""}|${game.deaths.length}`;
    if (key !== ver.current) {
      ver.current = key;
      force((x) => x + 1);
    }
  });
  const ids = [...game.units.keys()];
  const rewind = game.phase === "rewind" ? game.rewindUnits.map((u) => u.id) : [];
  return (
    <>
      {game.phase !== "rewind" &&
        ids.map((id) => <Operator key={id} get={() => game.units.get(id)} />)}
      {rewind.map((id) => (
        <Operator key={`rw:${id}`} get={() => game.rewindUnits.find((u) => u.id === id)} />
      ))}
      {game.deaths.map((d) => (
        <DeathBody key={`d:${d.unit.id}:${d.t0}`} unit={d.unit} t0={d.t0} />
      ))}
    </>
  );
}
