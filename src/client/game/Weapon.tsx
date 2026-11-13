import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { RIFLE, SIDE_COLORS } from "../../shared/constants";
import { buildHands, buildRifle, type MatKey } from "./models";
import { game } from "./runtime";
import { flashSideTexture, flashTexture, ringTexture, surface } from "./textures";

/** The viewmodel is authored at real scale and shrunk toward the camera so it
 *  never clips into walls (the player collider keeps walls > 0.34 m away). */
const VM_SCALE = 0.38;
const HIP = new THREE.Vector3(0.13, -0.13, 0.02);
const SPRINT = new THREE.Vector3(0.1, -0.17, 0.0);

function smoothstep(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export function Weapon() {
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const model = useMemo(() => buildRifle(false), []);
  const hands = useMemo(() => buildHands(), []);
  const root = useRef<THREE.Group>(null);
  const sway = useRef<THREE.Group>(null);
  const gun = useRef<THREE.Group>(null);
  const mag = useRef<THREE.Group>(null);
  const charging = useRef<THREE.Group>(null);
  const leftHand = useRef<THREE.Group>(null);
  const flashA = useRef<THREE.Mesh>(null);
  const flashB = useRef<THREE.Mesh>(null);
  const flashLight = useRef<THREE.PointLight>(null);
  const muzzle = useRef<THREE.Object3D>(null);
  const shellsRef = useRef<THREE.InstancedMesh>(null);

  const mats = useMemo(() => {
    const gm = surface("gunmetal", 512, 8);
    const accent = new THREE.MeshStandardMaterial({ color: "#000", emissive: new THREE.Color(SIDE_COLORS[0]), emissiveIntensity: 3.5, toneMapped: false });
    const m: Record<MatKey, THREE.Material> = {
      metal: new THREE.MeshStandardMaterial({ color: "#d4dce6", map: gm.map, normalMap: gm.normalMap, roughnessMap: gm.ormMap, metalnessMap: gm.ormMap, roughness: 1, metalness: 1, envMapIntensity: 1.3 }),
      polymer: new THREE.MeshStandardMaterial({ color: "#363c44", roughness: 0.58, metalness: 0.05, normalMap: gm.normalMap, normalScale: new THREE.Vector2(0.4, 0.4) }),
      dark: new THREE.MeshStandardMaterial({ color: "#1d2126", roughness: 0.4, metalness: 0.75 }),
      accent,
      glass: new THREE.MeshPhysicalMaterial({ color: "#a8e6ff", roughness: 0, metalness: 0, transparent: true, opacity: 0.16, envMapIntensity: 2.5, depthWrite: false }),
      armor: new THREE.MeshStandardMaterial({ color: "#6f7985", roughness: 0.45, metalness: 0.55 }),
      fabric: new THREE.MeshStandardMaterial({ color: "#2c3239", roughness: 0.9, metalness: 0 }),
      visor: accent,
      skin: new THREE.MeshStandardMaterial({ color: "#8a6a55" }),
    };
    return m;
  }, []);

  const reticleMat = useMemo(
    () => new THREE.MeshBasicMaterial({ map: ringTexture(), color: new THREE.Color(4, 0.6, 0.4), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
    [],
  );
  const flashMat = useMemo(() => new THREE.MeshBasicMaterial({ map: flashTexture(), color: new THREE.Color(4, 3, 2), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide }), []);
  const flashSideMat = useMemo(() => new THREE.MeshBasicMaterial({ map: flashSideTexture(), color: new THREE.Color(3, 2.2, 1.4), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide }), []);

  // shells (in viewmodel space)
  const shells = useMemo(() => {
    const geo = new THREE.CylinderGeometry(0.0055, 0.0055, 0.045, 8);
    geo.rotateZ(Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ color: "#c9a14a", metalness: 1, roughness: 0.25 });
    return { geo, mat, list: [] as { p: THREE.Vector3; v: THREE.Vector3; r: THREE.Euler; w: THREE.Vector3; t: number }[] };
  }, []);

  // attach the viewmodel to the camera
  useEffect(() => {
    const r = root.current!;
    camera.add(r);
    if (!camera.parent) scene.add(camera);
    return () => {
      camera.remove(r);
    };
  }, [camera, scene]);

  const st = useRef({
    lastYaw: 0,
    lastPitch: 0,
    swayX: 0,
    swayY: 0,
    kick: 0,
    kickV: 0,
    kickRot: 0,
    kickRotV: 0,
    kickRoll: 0,
    lastFireCount: 0,
    raise: 0,
    sprint: 0,
    flashT: -1,
    lastSide: -1,
  });

  const tmp = useMemo(() => ({ v: new THREE.Vector3(), m: new THREE.Matrix4(), q: new THREE.Quaternion(), s: new THREE.Vector3(1, 1, 1) }), []);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const s = st.current;
    const r = root.current!;
    const visible = game.alive && (game.phase === "loop" || game.phase === "countdown" || game.phase === "roundEnd");
    r.visible = visible;
    if (game.side !== s.lastSide) {
      s.lastSide = game.side;
      (mats.accent as THREE.MeshStandardMaterial).emissive.set(SIDE_COLORS[game.side]);
    }
    if (!visible) {
      s.raise = 0;
      return;
    }
    s.raise = Math.min(1, s.raise + dt * 3);
    const now = game.now;
    const ads = game.adsBlend;
    s.sprint += ((game.sprinting ? 1 : 0) - s.sprint) * Math.min(1, dt * 8);

    // ---- sway from look motion
    let dyaw = game.yaw - s.lastYaw;
    if (dyaw > Math.PI) dyaw -= Math.PI * 2;
    if (dyaw < -Math.PI) dyaw += Math.PI * 2;
    const dpitch = game.pitch - s.lastPitch;
    s.lastYaw = game.yaw;
    s.lastPitch = game.pitch;
    const swayK = 1 - ads * 0.85;
    s.swayX += (THREE.MathUtils.clamp(dyaw * 1.6, -0.08, 0.08) * swayK - s.swayX) * Math.min(1, dt * 9);
    s.swayY += (THREE.MathUtils.clamp(dpitch * 1.6, -0.08, 0.08) * swayK - s.swayY) * Math.min(1, dt * 9);

    // ---- recoil springs
    if (game.fireCount !== s.lastFireCount) {
      const n = game.fireCount - s.lastFireCount;
      s.lastFireCount = game.fireCount;
      for (let i = 0; i < n; i++) {
        s.kickV += ads > 0.5 ? 0.55 : 0.9;
        s.kickRotV += ads > 0.5 ? 0.9 : 1.8;
        s.kickRoll = (Math.random() - 0.5) * 0.05;
        s.flashT = now;
      }
    }
    const spring = (x: number, v: number, k: number, d: number) => {
      const a = -k * x - d * v;
      v += a * dt;
      x += v * dt;
      return [x, v];
    };
    [s.kick, s.kickV] = spring(s.kick, s.kickV, 260, 22);
    [s.kickRot, s.kickRotV] = spring(s.kickRot, s.kickRotV, 220, 20);
    s.kickRoll *= Math.exp(-dt * 10);

    // ---- base pose: hip / ADS / sprint
    const sightY = model.sight.y;
    const adsPos = new THREE.Vector3(0, -sightY, 0.075);
    const pos = HIP.clone().lerp(adsPos, ads).lerp(SPRINT, s.sprint * (1 - ads));
    // walk bob
    const speed = Math.hypot(game.move.vx, game.move.vz);
    const bobAmt = Math.min(1, speed / 4.7) * (1 - ads * 0.9) * (game.move.onGround ? 1 : 0.2);
    const bp = game.bobPhase;
    pos.x += Math.cos(bp) * 0.012 * bobAmt * (1 + s.sprint);
    pos.y += Math.abs(Math.sin(bp)) * 0.012 * bobAmt * (1 + s.sprint) - game.landDip * 0.25;
    // idle breathing
    pos.y += Math.sin(now * 1.6) * 0.0018 * (1 - ads * 0.7);
    pos.z += s.kick * 0.06;
    // raise on spawn
    pos.y -= (1 - s.raise) * 0.25;

    // ---- reload choreography
    let reloadTilt = 0,
      magDrop = 0,
      handDown = 0,
      chargeBack = 0;
    if (game.reloading) {
      const t = (now - game.reloadStart) / RIFLE.reloadTime;
      reloadTilt = smoothstep(0, 0.15, t) * (1 - smoothstep(0.82, 1, t));
      magDrop = smoothstep(0.14, 0.3, t) * (1 - smoothstep(0.42, 0.62, t));
      handDown = smoothstep(0.12, 0.28, t) * (1 - smoothstep(0.55, 0.68, t));
      chargeBack = smoothstep(0.74, 0.8, t) * (1 - smoothstep(0.83, 0.88, t));
      if (t > 0.62 && t < 0.66) pos.y += 0.008; // mag slap
    }

    sway.current!.position.copy(pos);
    sway.current!.rotation.set(
      s.swayY * 0.9 + s.kickRot * 0.07 - reloadTilt * 0.35 + s.sprint * (1 - ads) * -0.35,
      s.swayX * 1.1 + s.sprint * (1 - ads) * 0.75 + reloadTilt * 0.25 + 0.035 * (1 - ads),
      -s.swayX * 0.6 + s.kickRoll + reloadTilt * 0.55 + s.sprint * (1 - ads) * 0.32,
    );
    if (mag.current) {
      mag.current.position.copy(model.magPivot).add(new THREE.Vector3(0, -magDrop * 0.28, magDrop * 0.06));
      mag.current.rotation.x = magDrop * 0.6;
    }
    if (leftHand.current) {
      leftHand.current.position.set(handDown * 0.05, -handDown * 0.18, handDown * 0.32);
      leftHand.current.rotation.x = handDown * 0.5;
    }
    if (charging.current) charging.current.position.z = chargeBack * 0.07;

    // ---- muzzle flash
    const since = now - s.flashT;
    const on = since < 0.045;
    if (flashA.current && flashB.current) {
      flashA.current.visible = flashB.current.visible = on;
      if (on) {
        const k = 0.7 + Math.random() * 0.6;
        flashA.current.scale.setScalar(k);
        flashA.current.rotation.z = Math.random() * Math.PI;
        flashB.current.scale.set(k, k, k);
      }
    }
    if (flashLight.current) flashLight.current.intensity = on ? 6 : 0;

    // reticle fades in when aiming down sights
    reticleMat.opacity = smoothstep(0.55, 1, ads);

    // muzzle world position for tracers
    if (muzzle.current) muzzle.current.getWorldPosition(game.muzzleWorld);

    // ---- shells
    while (game.shellsToSpawn > 0) {
      game.shellsToSpawn--;
      const p = model.ejection.clone().add(new THREE.Vector3(0.02, 0, 0)).applyMatrix4(gun.current!.matrix).applyMatrix4(sway.current!.matrix);
      shells.list.push({
        p,
        v: new THREE.Vector3(1.1 + Math.random() * 0.5, 0.9 + Math.random() * 0.5, 0.25 + Math.random() * 0.2),
        r: new THREE.Euler(Math.random() * 3, Math.random() * 3, Math.random() * 3),
        w: new THREE.Vector3(Math.random() * 30, Math.random() * 30, Math.random() * 30),
        t: now,
      });
      if (shells.list.length > 16) shells.list.shift();
    }
    const im = shellsRef.current;
    if (im) {
      let n = 0;
      shells.list = shells.list.filter((sh) => now - sh.t < 0.7);
      for (const sh of shells.list) {
        sh.v.y -= 6 * dt;
        sh.p.addScaledVector(sh.v, dt);
        sh.r.x += sh.w.x * dt;
        sh.r.y += sh.w.y * dt;
        sh.r.z += sh.w.z * dt;
        tmp.q.setFromEuler(sh.r);
        tmp.m.compose(sh.p, tmp.q, tmp.s);
        im.setMatrixAt(n++, tmp.m);
      }
      im.count = n;
      im.instanceMatrix.needsUpdate = true;
    }
  });

  const parts = (list: { geo: THREE.BufferGeometry; mat: MatKey }[]) => list.map((p, i) => <mesh key={i} geometry={p.geo} material={mats[p.mat]} />);

  return (
    <group ref={root} scale={VM_SCALE}>
      <group ref={sway}>
        <group ref={gun}>
          {parts(model.body)}
          <group ref={charging}>{parts(model.charging)}</group>
          <group ref={mag} position={model.magPivot}>
            {parts(model.mag)}
          </group>
          <mesh position={model.reticle} material={reticleMat} renderOrder={5}>
            <planeGeometry args={[0.012, 0.012]} />
          </mesh>
          {parts(hands.right)}
          <group ref={leftHand}>{parts(hands.left)}</group>
          <object3D ref={muzzle} position={model.muzzle} />
          <mesh ref={flashA} position={model.muzzle.clone().add(new THREE.Vector3(0, 0, -0.03))} material={flashMat}>
            <planeGeometry args={[0.16, 0.16]} />
          </mesh>
          <mesh ref={flashB} position={model.muzzle.clone().add(new THREE.Vector3(0, 0, -0.1))} rotation={[0, Math.PI / 2, 0]} material={flashSideMat}>
            <planeGeometry args={[0.22, 0.09]} />
          </mesh>
          <pointLight ref={flashLight} position={model.muzzle} color="#ffb067" distance={4} decay={2} intensity={0} />
        </group>
      </group>
      {/* soft key + rim light that travel with the viewmodel so it always reads clearly */}
      <pointLight position={[-0.9, 0.9, 0.4]} color="#dbe8ff" intensity={0.35} distance={3} decay={2} />
      <pointLight position={[1.2, 0.3, -1.6]} color={SIDE_COLORS[0]} intensity={0.3} distance={3} decay={2} />
      <instancedMesh ref={shellsRef} args={[shells.geo, shells.mat, 16]} frustumCulled={false} />
    </group>
  );
}
