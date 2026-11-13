import { Environment, Lightformer, MeshReflectorMaterial } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { POINT_RADIUS, SIDE_COLORS } from "../../shared/constants";
import { ARENA, BOXES, POINT_CENTER, type Box } from "../../shared/map";
import { net } from "../net/NetClient";
import type { QualityPreset } from "./quality";
import { makeBeamMaterial, makeCaptureMaterial, makeSkyMaterial, sharedTime } from "./shaders";
import { glowTexture, holoSignTexture, surface, windowsTexture, type SurfaceKind } from "./textures";

const C0 = new THREE.Color(SIDE_COLORS[0]);
const C1 = new THREE.Color(SIDE_COLORS[1]);
const NEUTRAL = new THREE.Color("#cfe6ff");

/** Box geometry with world-space (triplanar) UVs so textures keep real-world scale. */
function worldBox(min: number[], max: number[], tile: number): THREE.BufferGeometry {
  const w = max[0] - min[0],
    h = max[1] - min[1],
    d = max[2] - min[2];
  const cx = (min[0] + max[0]) / 2,
    cy = (min[1] + max[1]) / 2,
    cz = (min[2] + max[2]) / 2;
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(cx, cy, cz);
  const pos = g.attributes.position,
    nrm = g.attributes.normal,
    uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i),
      y = pos.getY(i),
      z = pos.getZ(i);
    const nx = Math.abs(nrm.getX(i)),
      ny = Math.abs(nrm.getY(i));
    if (nx > 0.5) uv.setXY(i, z / tile, y / tile);
    else if (ny > 0.5) uv.setXY(i, x / tile, z / tile);
    else uv.setXY(i, x / tile, y / tile);
  }
  return g;
}

function merged(boxes: { min: number[]; max: number[] }[], tile: number) {
  if (!boxes.length) return null;
  return mergeGeometries(boxes.map((b) => worldBox(b.min, b.max, tile)), false);
}

function usePBR(kind: SurfaceKind, q: QualityPreset, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return useMemo(() => {
    const s = surface(kind, q.texSize, q.anisotropy);
    return new THREE.MeshStandardMaterial({
      map: s.map,
      normalMap: s.normalMap,
      roughnessMap: s.ormMap,
      metalnessMap: s.ormMap,
      roughness: 1,
      metalness: 1,
      envMapIntensity: 1,
      ...opts,
    });
  }, [kind, q.texSize, q.anisotropy]); // eslint-disable-line react-hooks/exhaustive-deps
}

const emissive = (c: THREE.Color, k = 3) => new THREE.MeshStandardMaterial({ color: "#000", emissive: c, emissiveIntensity: k, toneMapped: false, roughness: 0.4 });

const sideColor = (x: number) => (x < -1 ? C0 : x > 1 ? C1 : NEUTRAL);

export function Arena({ q }: { q: QualityPreset }) {
  const concrete = usePBR("concrete", q);
  const metal = usePBR("metal", q);
  const darkmetal = usePBR("darkmetal", q);
  const crate = usePBR("crate", q);
  const floorSet = useMemo(() => surface("floor", q.texSize, q.anisotropy), [q.texSize, q.anisotropy]);

  const glass = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: "#9fdcff",
        roughness: 0.04,
        metalness: 0.1,
        transparent: true,
        opacity: 0.22,
        envMapIntensity: 2.2,
        clearcoat: 1,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    [],
  );

  // ---- merged architecture by material
  const geos = useMemo(() => {
    const by: Record<string, Box[]> = {};
    for (const b of BOXES) (by[b.mat] ||= []).push(b);
    const platform = by.platform || [];
    return {
      concrete: merged(by.concrete || [], 4),
      metal: merged(by.metal || [], 2),
      darkmetal: merged([...(by.darkmetal || []), ...platform], 2.5),
      crate: merged(by.crate || [], 2),
      glass: merged(by.glass || [], 3),
    };
  }, []);

  // ---- emissive trims & decor (thin, non-colliding)
  const trims = useMemo(() => {
    const lists: { min: number[]; max: number[] }[][] = [[], [], []];
    const push = (x: number, min: number[], max: number[]) => lists[x < -1 ? 0 : x > 1 ? 1 : 2].push({ min, max });
    const t = 0.05;
    for (const b of BOXES) {
      const [x0, y0, z0] = b.min,
        [x1, y1, z1] = b.max;
      const cx = (x0 + x1) / 2;
      if (b.tag === "outer") continue;
      if (b.tag === "stair") {
        // glowing step nosing
        push(cx, [x0 - 0.01, y1 - 0.04, z0 + 0.1], [x0 + 0.03, y1 + 0.005, z1 - 0.1]);
        push(cx, [x1 - 0.03, y1 - 0.04, z0 + 0.1], [x1 + 0.01, y1 + 0.005, z1 - 0.1]);
        continue;
      }
      if (b.mat === "glass") {
        push(cx, [x0 - t, y1 - t, z0 - t], [x1 + t, y1 + t, z1 + t]);
        push(cx, [x0 - t, y0, z0 - t], [x1 + t, y0 + t * 2, z1 + t]);
        continue;
      }
      if (b.tag === "point") {
        push(0, [x0 - t, y1 - 0.06, z0 - t], [x1 + t, y1 - 0.02, z0 + t]);
        push(0, [x0 - t, y1 - 0.06, z1 - t], [x1 + t, y1 - 0.02, z1 + t]);
        push(0, [x0 - t, y1 - 0.06, z0], [x0 + t, y1 - 0.02, z1]);
        push(0, [x1 - t, y1 - 0.06, z0], [x1 + t, y1 - 0.02, z1]);
        continue;
      }
      // top edge strips on two long sides
      const longX = x1 - x0 >= z1 - z0;
      const inset = 0.06;
      if (longX) {
        push(cx, [x0 + inset, y1 - 0.12, z0 - 0.02], [x1 - inset, y1 - 0.07, z0 + 0.01]);
        push(cx, [x0 + inset, y1 - 0.12, z1 - 0.01], [x1 - inset, y1 - 0.07, z1 + 0.02]);
      } else {
        push(cx, [x0 - 0.02, y1 - 0.12, z0 + inset], [x0 + 0.01, y1 - 0.07, z1 - inset]);
        push(cx, [x1 - 0.01, y1 - 0.12, z0 + inset], [x1 + 0.02, y1 - 0.07, z1 - inset]);
      }
      if (b.tag === "pillar") {
        for (const yy of [1.2, 3.4, 5.6]) {
          push(cx, [x0 - 0.02, yy, z0 + 0.15], [x0 + 0.01, yy + 0.9, z0 + 0.22]);
          push(cx, [x1 - 0.01, yy, z1 - 0.22], [x1 + 0.02, yy + 0.9, z1 - 0.15]);
        }
      }
      if (b.tag === "generator") {
        for (let yy = 0.6; yy < y1 - 0.4; yy += 0.55) push(cx, [x0 - 0.02, yy, z0 + 0.4], [x0 + 0.01, yy + 0.08, z1 - 0.4]);
      }
    }
    // perimeter wall light strips + pilaster lights
    const X = ARENA.halfX,
      Z = ARENA.halfZ;
    for (const y of [3.1, 8.3]) {
      for (const sx of [-1, 1]) {
        push(sx * 10, [sx > 0 ? 0.5 : -X + 0.3, y, -Z], [sx > 0 ? X - 0.3 : -0.5, y + 0.07, -Z + 0.04]);
        push(sx * 10, [sx > 0 ? 0.5 : -X + 0.3, y, Z - 0.04], [sx > 0 ? X - 0.3 : -0.5, y + 0.07, Z]);
      }
      push(-20, [-X, y, -Z + 0.3], [-X + 0.04, y + 0.07, Z - 0.3]);
      push(20, [X - 0.04, y, -Z + 0.3], [X, y + 0.07, Z - 0.3]);
    }
    const pil: { min: number[]; max: number[] }[] = [];
    for (let x = -X + 3; x <= X - 3; x += 5.5) {
      for (const sz of [-1, 1]) {
        const z0 = sz < 0 ? -Z : Z - 0.25,
          z1 = sz < 0 ? -Z + 0.25 : Z;
        pil.push({ min: [x - 0.35, 0, z0], max: [x + 0.35, ARENA.wallHeight, z1] });
        push(x, [x - 0.08, 4.0, sz < 0 ? z1 : z0 - 0.02], [x + 0.08, 7.4, sz < 0 ? z1 + 0.02 : z0]);
      }
    }
    for (let z = -Z + 3; z <= Z - 3; z += 5.5) {
      for (const sx of [-1, 1]) {
        const x0 = sx < 0 ? -X : X - 0.25,
          x1 = sx < 0 ? -X + 0.25 : X;
        pil.push({ min: [x0, 0, z - 0.35], max: [x1, ARENA.wallHeight, z + 0.35] });
        push(sx * 20, [sx < 0 ? x1 : x0 - 0.02, 4.0, z - 0.08], [sx < 0 ? x1 + 0.02 : x0, 7.4, z + 0.08]);
      }
    }
    // skirting
    pil.push({ min: [-X, 0, -Z], max: [X, 0.35, -Z + 0.12] }, { min: [-X, 0, Z - 0.12], max: [X, 0.35, Z] });
    pil.push({ min: [-X, 0, -Z], max: [-X + 0.12, 0.35, Z] }, { min: [X - 0.12, 0, -Z], max: [X, 0.35, Z] });
    // floor lane lines
    for (const z of [-13, 13]) {
      push(-10, [-25, 0.003, z - 0.04], [-6, 0.012, z + 0.04]);
      push(10, [6, 0.003, z - 0.04], [25, 0.012, z + 0.04]);
    }
    return {
      c0: merged(lists[0], 1),
      c1: merged(lists[1], 1),
      n: merged(lists[2], 1),
      pilasters: merged(pil, 2),
    };
  }, []);

  const trimMats = useMemo(() => [emissive(C0, 4), emissive(C1, 4), emissive(NEUTRAL, 2.5)], []);

  // ---- floor with world-space UVs
  const floorGeo = useMemo(() => {
    const g = new THREE.PlaneGeometry(ARENA.halfX * 2, ARENA.halfZ * 2, 1, 1);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position,
      uv = g.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / 6, pos.getZ(i) / 6);
    return g;
  }, []);

  const shadow = q.shadows;

  return (
    <group>
      <Sky />
      <Skyline />
      <Environment resolution={q.envRes} frames={1} background={false}>
        <Lightformer form="rect" intensity={2.2} color="#cfe3ff" position={[0, 12, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[40, 10, 1]} />
        <Lightformer form="rect" intensity={3} color={SIDE_COLORS[0]} position={[-30, 4, 0]} rotation={[0, Math.PI / 2, 0]} scale={[30, 1.2, 1]} />
        <Lightformer form="rect" intensity={3} color={SIDE_COLORS[1]} position={[30, 4, 0]} rotation={[0, -Math.PI / 2, 0]} scale={[30, 1.2, 1]} />
        <Lightformer form="ring" intensity={4} color="#e8f4ff" position={[0, 16, 0]} rotation={[Math.PI / 2, 0, 0]} scale={8} />
        <Lightformer form="rect" intensity={0.8} color="#506080" position={[0, 3, -22]} scale={[60, 4, 1]} />
        <Lightformer form="rect" intensity={0.8} color="#506080" position={[0, 3, 22]} rotation={[0, Math.PI, 0]} scale={[60, 4, 1]} />
      </Environment>

      {/* lighting */}
      <hemisphereLight args={["#7c93b8", "#141820", 0.55]} />
      <directionalLight
        position={[16, 38, 10]}
        intensity={1.6}
        color="#c9dcff"
        castShadow={shadow}
        shadow-mapSize-width={q.shadowMap}
        shadow-mapSize-height={q.shadowMap}
        shadow-camera-left={-38}
        shadow-camera-right={38}
        shadow-camera-top={26}
        shadow-camera-bottom={-26}
        shadow-camera-near={5}
        shadow-camera-far={80}
        shadow-bias={-0.0004}
        shadow-normalBias={0.035}
      />
      <PointLights count={q.pointLights} />

      {/* floor */}
      <mesh geometry={floorGeo} receiveShadow={shadow}>
        {q.reflector ? (
          <MeshReflectorMaterial
            resolution={q.reflector}
            blur={[280, 90]}
            mixBlur={1}
            mixStrength={3.2}
            mixContrast={1.1}
            mirror={0.55}
            depthScale={0.6}
            minDepthThreshold={0.6}
            maxDepthThreshold={1.3}
            map={floorSet.map}
            normalMap={floorSet.normalMap}
            normalScale={new THREE.Vector2(0.6, 0.6)}
            roughnessMap={floorSet.ormMap}
            metalnessMap={floorSet.ormMap}
            roughness={1}
            metalness={0.85}
            color="#9aa3ad"
            envMapIntensity={0.8}
          />
        ) : (
          <meshStandardMaterial map={floorSet.map} normalMap={floorSet.normalMap} roughnessMap={floorSet.ormMap} metalnessMap={floorSet.ormMap} roughness={1} metalness={1} envMapIntensity={1.1} />
        )}
      </mesh>

      {geos.concrete && <mesh geometry={geos.concrete} material={concrete} castShadow={shadow} receiveShadow={shadow} />}
      {geos.metal && <mesh geometry={geos.metal} material={metal} castShadow={shadow} receiveShadow={shadow} />}
      {geos.darkmetal && <mesh geometry={geos.darkmetal} material={darkmetal} castShadow={shadow} receiveShadow={shadow} />}
      {geos.crate && <mesh geometry={geos.crate} material={crate} castShadow={shadow} receiveShadow={shadow} />}
      {geos.glass && <mesh geometry={geos.glass} material={glass} renderOrder={2} />}
      {trims.pilasters && <mesh geometry={trims.pilasters} material={darkmetal} receiveShadow={shadow} />}
      {trims.c0 && <mesh geometry={trims.c0} material={trimMats[0]} />}
      {trims.c1 && <mesh geometry={trims.c1} material={trimMats[1]} />}
      {trims.n && <mesh geometry={trims.n} material={trimMats[2]} />}

      <Signs />
      <CapturePoint q={q} />
      <ChronoRing />
      <Dust count={Math.round(500 * q.particles)} />
      <GeneratorCores />
    </group>
  );
}

function PointLights({ count }: { count: number }) {
  const all: [number, number, number, THREE.Color][] = [
    [0, 5, 0, NEUTRAL],
    [-28, 4, 0, C0],
    [28, 4, 0, C1],
    [-17, 5, 18, C0],
    [17, 5, -18, C1],
    [0, 3, 13, NEUTRAL],
  ];
  return (
    <>
      {all.slice(0, count).map(([x, y, z, c], i) => (
        <pointLight key={i} position={[x, y, z]} color={c} intensity={i === 0 ? 30 : 22} distance={i === 0 ? 16 : 14} decay={2} />
      ))}
    </>
  );
}

function Sky() {
  const mat = useMemo(() => makeSkyMaterial(), []);
  return (
    <mesh material={mat} renderOrder={-10} frustumCulled={false}>
      <sphereGeometry args={[400, 32, 16]} />
    </mesh>
  );
}

/** Distant megastructure skyline with lit windows (instanced). */
function Skyline() {
  const ref = useRef<THREE.InstancedMesh>(null);
  const { geo, mat, count, mats } = useMemo(() => {
    const tex = windowsTexture();
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    const mat = new THREE.MeshStandardMaterial({ color: "#05070b", emissive: "#ffffff", emissiveMap: tex, emissiveIntensity: 0.85, roughness: 0.6, metalness: 0.4 });
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mats: THREE.Matrix4[] = [];
    let seed = 7;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 90; i++) {
      const a = (i / 90) * Math.PI * 2 + r() * 0.05;
      const dist = 80 + r() * 110;
      const w = 8 + r() * 16,
        d = 8 + r() * 16,
        h = 20 + r() * (dist > 140 ? 140 : 80);
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(Math.cos(a) * dist * 1.25, h / 2 - 4, Math.sin(a) * dist),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * Math.PI),
        new THREE.Vector3(w, h, d),
      );
      mats.push(m);
    }
    return { geo, mat, count: mats.length, mats };
  }, []);
  useMemo(() => {
    // per-instance uv scale via onBeforeCompile is overkill; scale repeat globally
    (mat.emissiveMap as THREE.Texture).repeat.set(1, 1);
  }, [mat]);
  return (
    <instancedMesh
      ref={(m) => {
        if (!m) return;
        (ref as React.MutableRefObject<THREE.InstancedMesh>).current = m;
        mats.forEach((mm, i) => m.setMatrixAt(i, mm));
        m.instanceMatrix.needsUpdate = true;
      }}
      args={[geo, mat, count]}
      frustumCulled={false}
    />
  );
}

function Signs() {
  const items = useMemo(() => {
    const mk = (text: string, color: string) =>
      new THREE.MeshBasicMaterial({ map: holoSignTexture(text, color), transparent: true, toneMapped: false, depthWrite: false, blending: THREE.AdditiveBlending, color: new THREE.Color(1.6, 1.6, 1.6) });
    return [
      { pos: [0, 6.2, -21.85] as const, rot: 0, mat: mk("PARADOX POINT", "#bfe9ff") },
      { pos: [0, 6.2, 21.85] as const, rot: Math.PI, mat: mk("PARADOX POINT", "#bfe9ff") },
      { pos: [-33.85, 6.2, 0] as const, rot: Math.PI / 2, mat: mk("CYAN SECTOR", SIDE_COLORS[0]) },
      { pos: [33.85, 6.2, 0] as const, rot: -Math.PI / 2, mat: mk("EMBER SECTOR", SIDE_COLORS[1]) },
    ];
  }, []);
  return (
    <>
      {items.map((s, i) => (
        <mesh key={i} position={s.pos as unknown as THREE.Vector3Tuple} rotation={[0, s.rot, 0]} material={s.mat}>
          <planeGeometry args={[16, 16]} />
        </mesh>
      ))}
    </>
  );
}

function CapturePoint({ q }: { q: QualityPreset }) {
  const ringMat = useMemo(() => makeCaptureMaterial(), []);
  const beamMat = useMemo(() => makeBeamMaterial("#bfe6ff", 1.2), []);
  const core = useRef<THREE.Group>(null);
  const light = useRef<THREE.PointLight>(null);
  const coreMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#000", emissive: NEUTRAL.clone(), emissiveIntensity: 1.25, toneMapped: false, roughness: 0.2, metalness: 0.5 }),
    [],
  );
  const shellMat = useMemo(
    () => new THREE.MeshPhysicalMaterial({ color: "#d8f0ff", roughness: 0.02, metalness: 0, transparent: true, opacity: 0.18, envMapIntensity: 3, clearcoat: 1, depthWrite: false }),
    [],
  );
  const col = useMemo(() => new THREE.Color(), []);
  useFrame((_, dt) => {
    const s = net.state;
    const meter = s ? s.meter / 100 : 0;
    const state = s && s.phase === "loop" ? s.capture : -1;
    ringMat.uniforms.uMeter.value += (meter - ringMat.uniforms.uMeter.value) * Math.min(1, dt * 6);
    ringMat.uniforms.uState.value = state;
    const target = Math.abs(meter) < 0.02 ? NEUTRAL : meter > 0 ? C0 : C1;
    col.copy(NEUTRAL).lerp(target, Math.min(1, Math.abs(meter) * 2 + 0.3));
    coreMat.emissive.lerp(col, Math.min(1, dt * 4));
    (beamMat.uniforms.uColor.value as THREE.Color).lerp(col, Math.min(1, dt * 3));
    if (core.current) {
      core.current.rotation.y += dt * (state >= 0 ? 2.2 : 0.5);
      core.current.position.y = 2.2 + Math.sin(sharedTime.value * 1.3) * 0.12;
    }
    if (light.current) {
      light.current.color.copy(coreMat.emissive);
      light.current.intensity = 14 + (state >= 0 ? 8 * (0.5 + 0.5 * Math.sin(sharedTime.value * 8)) : 0);
    }
  });
  return (
    <group position={[POINT_CENTER.x, 0, POINT_CENTER.z]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, POINT_CENTER.y + 0.012, 0]} material={ringMat} renderOrder={3}>
        <planeGeometry args={[POINT_RADIUS * 2, POINT_RADIUS * 2]} />
      </mesh>
      <group ref={core} position={[0, 2.2, 0]}>
        {/* hourglass time core */}
        <mesh material={coreMat} position={[0, 0.22, 0]} rotation={[Math.PI, 0, 0]}>
          <coneGeometry args={[0.2, 0.42, 6]} />
        </mesh>
        <mesh material={coreMat} position={[0, -0.22, 0]}>
          <coneGeometry args={[0.2, 0.42, 6]} />
        </mesh>
        <mesh material={shellMat}>
          <icosahedronGeometry args={[0.75, 1]} />
        </mesh>
        <mesh>
          <torusGeometry args={[0.95, 0.025, 8, 64]} />
          <meshStandardMaterial color="#20262e" metalness={1} roughness={0.25} />
        </mesh>
      </group>
      <mesh position={[0, 9, 0]} material={beamMat}>
        <cylinderGeometry args={[2.6, POINT_RADIUS, 17, 32, 1, true]} />
      </mesh>
      {q.pointLights > 0 && <pointLight ref={light} position={[0, 2.4, 0]} distance={12} decay={2} intensity={14} />}
    </group>
  );
}

/** Giant rotating ring above the point — the arena's signature set piece. */
function ChronoRing() {
  const outer = useRef<THREE.Group>(null);
  const inner = useRef<THREE.Group>(null);
  const segs = useMemo(() => {
    const g: { a: number }[] = [];
    for (let i = 0; i < 24; i++) g.push({ a: (i / 24) * Math.PI * 2 });
    return g;
  }, []);
  const metal = useMemo(() => new THREE.MeshStandardMaterial({ color: "#3a414b", metalness: 0.95, roughness: 0.28 }), []);
  const glow = useMemo(() => emissive(new THREE.Color("#9fe6ff"), 3.5), []);
  useFrame((_, dt) => {
    if (outer.current) outer.current.rotation.y += dt * 0.08;
    if (inner.current) inner.current.rotation.y -= dt * 0.2;
  });
  return (
    <group position={[0, 17.5, 0]}>
      <group ref={outer}>
        <mesh material={metal} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[11, 0.45, 12, 96]} />
        </mesh>
        {segs.map(({ a }, i) => (
          <group key={i} rotation={[0, a, 0]}>
            <mesh material={metal} position={[11, 0, 0]}>
              <boxGeometry args={[1.6, 1.4, 0.9]} />
            </mesh>
            <mesh material={glow} position={[10.15, 0, 0]}>
              <boxGeometry args={[0.06, 0.7, 0.5]} />
            </mesh>
          </group>
        ))}
      </group>
      <group ref={inner} rotation={[0.18, 0, 0.1]}>
        <mesh material={glow} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[7.5, 0.06, 8, 128]} />
        </mesh>
        <mesh material={metal} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[7.9, 0.2, 8, 96]} />
        </mesh>
      </group>
    </group>
  );
}

function GeneratorCores() {
  const mats = useMemo(() => [emissive(C0, 5), emissive(C1, 5)], []);
  const refs = useRef<THREE.Mesh[]>([]);
  useFrame(() => {
    refs.current.forEach((m, i) => {
      if (m) m.rotation.y = sharedTime.value * (i ? -1.5 : 1.5);
    });
  });
  const gens = BOXES.filter((b) => b.tag === "generator");
  return (
    <>
      {gens.map((b, i) => {
        const cx = (b.min[0] + b.max[0]) / 2,
          cz = (b.min[2] + b.max[2]) / 2;
        const side = cx < 0 ? 0 : 1;
        return (
          <group key={i} position={[cx, b.max[1], cz]}>
            <mesh
              ref={(m) => {
                if (m) refs.current[i] = m;
              }}
              material={mats[side]}
              position={[0, 0.9, 0]}
            >
              <cylinderGeometry args={[0.5, 0.5, 1.6, 6]} />
            </mesh>
            <mesh position={[0, 0.06, 0]}>
              <cylinderGeometry args={[1.2, 1.4, 0.12, 24]} />
              <meshStandardMaterial color="#2a2f36" metalness={1} roughness={0.3} />
            </mesh>
          </group>
        );
      })}
    </>
  );
}

function Dust({ count }: { count: number }) {
  const { geo, mat } = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const p = new Float32Array(count * 3);
    const s = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      p[i * 3] = (Math.random() - 0.5) * ARENA.halfX * 2;
      p[i * 3 + 1] = Math.random() * 12;
      p[i * 3 + 2] = (Math.random() - 0.5) * ARENA.halfZ * 2;
      s[i] = Math.random();
    }
    g.setAttribute("position", new THREE.BufferAttribute(p, 3));
    g.setAttribute("seed", new THREE.BufferAttribute(s, 1));
    const m = new THREE.ShaderMaterial({
      uniforms: { uTime: sharedTime, uTex: { value: glowTexture() } },
      vertexShader: /* glsl */ `
        attribute float seed; uniform float uTime; varying float vA;
        void main(){
          vec3 p = position;
          p.y = mod(p.y + uTime * (0.08 + seed*0.12), 12.0);
          p.x += sin(uTime*0.3 + seed*20.0) * 0.6;
          p.z += cos(uTime*0.25 + seed*13.0) * 0.6;
          vec4 mv = modelViewMatrix * vec4(p,1.0);
          gl_PointSize = (2.0 + seed*4.0) * (40.0 / -mv.z);
          vA = 0.25 + 0.5*seed;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `uniform sampler2D uTex; varying float vA; void main(){ vec4 t = texture2D(uTex, gl_PointCoord); gl_FragColor = vec4(vec3(0.75,0.88,1.0)*t.a*vA, t.a*vA); }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    return { geo: g, mat: m };
  }, [count]);
  if (!count) return null;
  return <points geometry={geo} material={mat} frustumCulled={false} />;
}
