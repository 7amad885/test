import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { SIDE_COLORS } from "../../shared/constants";
import type { QualityPreset } from "./quality";
import { game } from "./runtime";
import { makeShockMaterial } from "./shaders";
import { glowTexture, holeTexture } from "./textures";

const MAX_TRACERS = 48;
const MAX_DECALS = 90;
const TRACER_SPEED = 260;
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

interface Particle {
  p: THREE.Vector3;
  v: THREE.Vector3;
  c: THREE.Color;
  life: number;
  max: number;
  size: number;
  grav: number;
}

export function Effects({ q }: { q: QualityPreset }) {
  const maxParticles = Math.round(700 * Math.max(0.4, q.particles));
  const tracerMesh = useRef<THREE.InstancedMesh>(null);
  const decalMesh = useRef<THREE.InstancedMesh>(null);
  const shockGroup = useRef<THREE.Group>(null);

  const tracer = useMemo(() => {
    const geo = new THREE.CylinderGeometry(0.012, 0.012, 1, 6, 1, true);
    geo.translate(0, 0.5, 0);
    const mat = new THREE.MeshBasicMaterial({ color: "#fff", transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    return { geo, mat, list: [] as { o: THREE.Vector3; d: THREE.Vector3; len: number; t0: number; col: THREE.Color }[] };
  }, []);

  const decals = useMemo(() => {
    const geo = new THREE.PlaneGeometry(0.11, 0.11);
    const mat = new THREE.MeshStandardMaterial({ map: holeTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: 0.9, metalness: 0 });
    return { geo, mat, next: 0, count: 0 };
  }, []);

  const parts = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(maxParticles * 3);
    const col = new Float32Array(maxParticles * 3);
    const size = new Float32Array(maxParticles);
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("size", new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: glowTexture() }, uScale: { value: 400 } },
      vertexShader: /* glsl */ `attribute float size; attribute vec3 color; varying vec3 vC; uniform float uScale;
        void main(){ vC = color; vec4 mv = modelViewMatrix*vec4(position,1.0); gl_PointSize = size * uScale / max(0.1, -mv.z); gl_Position = projectionMatrix*mv; }`,
      fragmentShader: /* glsl */ `uniform sampler2D uTex; varying vec3 vC; void main(){ vec4 t = texture2D(uTex, gl_PointCoord); gl_FragColor = vec4(vC * t.a, t.a); }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    return { geo, mat, list: [] as Particle[] };
  }, [maxParticles]);

  const shocks = useMemo(() => [] as { mesh: THREE.Mesh; t0: number; dur: number; max: number }[], []);
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), s: new THREE.Vector3(), p: new THREE.Vector3() }), []);
  const lastPhase = useRef("");

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const now = game.now;
    parts.mat.uniforms.uScale.value = state.size.height * 0.5;

    // time rewinds: the world heals, bullet holes vanish
    if (game.phase !== lastPhase.current) {
      if (game.phase === "rewind" || game.phase === "countdown") {
        decals.count = 0;
        decals.next = 0;
      }
      lastPhase.current = game.phase;
    }

    // ---- ingest new tracers
    for (const t of game.tracers) {
      const d = t.e.clone().sub(t.o);
      const len = d.length();
      if (len < 0.05) continue;
      d.divideScalar(len);
      const base = new THREE.Color(SIDE_COLORS[t.side]);
      const col = t.echo ? base.lerp(new THREE.Color("#c9a6ff"), 0.5).multiplyScalar(2.2) : base.lerp(new THREE.Color("#fff3d0"), 0.55).multiplyScalar(3);
      tracer.list.push({ o: t.o, d, len, t0: now, col });
      if (tracer.list.length > MAX_TRACERS) tracer.list.shift();
    }
    game.tracers.length = 0;

    // ---- ingest impacts
    const spawn = (p: THREE.Vector3, v: THREE.Vector3, c: THREE.Color, life: number, size: number, grav = 9) => {
      if (parts.list.length >= maxParticles) parts.list.shift();
      parts.list.push({ p: p.clone(), v, c, life, max: life, size, grav });
    };
    for (const im of game.impacts) {
      const n = im.n.clone().normalize();
      if (im.kind === "world") {
        const count = Math.round(9 * Math.max(0.5, q.particles));
        for (let i = 0; i < count; i++) {
          const v = n.clone().multiplyScalar(2 + Math.random() * 3).add(new THREE.Vector3((Math.random() - 0.5) * 4, Math.random() * 3, (Math.random() - 0.5) * 4));
          spawn(im.p, v, new THREE.Color(3, 1.8 + Math.random(), 0.8), 0.25 + Math.random() * 0.3, 0.035 + Math.random() * 0.03);
        }
        spawn(im.p.clone().addScaledVector(n, 0.03), new THREE.Vector3(), new THREE.Color(2.5, 1.8, 1.2), 0.07, 0.6, 0);
        for (let i = 0; i < 3; i++)
          spawn(im.p.clone().addScaledVector(n, 0.05), n.clone().multiplyScalar(0.5 + Math.random() * 0.6).add(new THREE.Vector3(0, 0.4, 0)), new THREE.Color(0.25, 0.25, 0.28), 0.8, 0.25 + Math.random() * 0.2, -0.5);
        // decal
        const dm = decalMesh.current;
        if (dm) {
          tmp.q.setFromUnitVectors(Z, n);
          const rot = new THREE.Quaternion().setFromAxisAngle(Z, Math.random() * Math.PI * 2);
          tmp.q.multiply(rot);
          const sc = 0.7 + Math.random() * 0.6;
          tmp.m.compose(im.p.clone().addScaledVector(n, 0.004), tmp.q, tmp.s.set(sc, sc, sc));
          dm.setMatrixAt(decals.next, tmp.m);
          decals.next = (decals.next + 1) % MAX_DECALS;
          decals.count = Math.min(MAX_DECALS, decals.count + 1);
          dm.count = decals.count;
          dm.instanceMatrix.needsUpdate = true;
        }
      } else {
        const c = new THREE.Color(SIDE_COLORS[1 - im.side] ?? "#fff").multiplyScalar(3);
        for (let i = 0; i < 14; i++) {
          const v = n.clone().multiplyScalar(1 + Math.random() * 2.5).add(new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 2.5, (Math.random() - 0.5) * 3));
          spawn(im.p, v, c.clone(), 0.3 + Math.random() * 0.3, 0.04 + Math.random() * 0.03, 4);
        }
        spawn(im.p, new THREE.Vector3(), c.clone().multiplyScalar(0.8), 0.09, 0.5, 0);
      }
    }
    game.impacts.length = 0;

    // ---- paradox shockwaves + bursts
    for (const p of game.paradoxFx) {
      const color = p.type === "rescued" ? "#ffd36b" : p.type === "erased" ? "#ff4d6d" : "#9fb3d1";
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), makeShockMaterial(color));
      mesh.position.copy(p.p).add(new THREE.Vector3(0, 1, 0));
      shockGroup.current?.add(mesh);
      shocks.push({ mesh, t0: now, dur: p.type === "fulfilled" ? 0.6 : 1.1, max: p.type === "fulfilled" ? 1.8 : 4.5 });
      const c = new THREE.Color(color).multiplyScalar(3);
      for (let i = 0; i < 40 * q.particles; i++) {
        const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).normalize().multiplyScalar(2 + Math.random() * 4);
        spawn(mesh.position, v, c.clone(), 0.6 + Math.random() * 0.6, 0.05 + Math.random() * 0.05, p.type === "rescued" ? -1 : 3);
      }
    }
    game.paradoxFx.length = 0;
    for (let i = shocks.length - 1; i >= 0; i--) {
      const s = shocks[i];
      const k = (now - s.t0) / s.dur;
      if (k >= 1) {
        s.mesh.removeFromParent();
        s.mesh.geometry.dispose();
        (s.mesh.material as THREE.Material).dispose();
        shocks.splice(i, 1);
        continue;
      }
      s.mesh.scale.setScalar(0.2 + (1 - Math.pow(1 - k, 3)) * s.max);
      ((s.mesh.material as THREE.ShaderMaterial).uniforms.uP as { value: number }).value = k;
    }

    // ---- tracers
    const tm = tracerMesh.current;
    if (tm) {
      let n = 0;
      tracer.list = tracer.list.filter((t) => (now - t.t0) * TRACER_SPEED - 7 < t.len);
      for (const t of tracer.list) {
        const head = Math.min(t.len, (now - t.t0) * TRACER_SPEED + 3);
        const tail = Math.max(0, head - 7);
        const segLen = head - tail;
        if (segLen <= 0.01) continue;
        tmp.p.copy(t.o).addScaledVector(t.d, tail);
        tmp.q.setFromUnitVectors(Y, t.d);
        const w = 1 + Math.min(2, tail * 0.05);
        tmp.m.compose(tmp.p, tmp.q, tmp.s.set(w, segLen, w));
        tm.setMatrixAt(n, tmp.m);
        tm.setColorAt(n, t.col);
        n++;
      }
      tm.count = n;
      tm.instanceMatrix.needsUpdate = true;
      if (tm.instanceColor) tm.instanceColor.needsUpdate = true;
    }

    // ---- particles
    const pos = parts.geo.attributes.position.array as Float32Array;
    const col = parts.geo.attributes.color.array as Float32Array;
    const size = parts.geo.attributes.size.array as Float32Array;
    let n = 0;
    parts.list = parts.list.filter((p) => (p.life -= dt) > 0);
    for (const p of parts.list) {
      p.v.y -= p.grav * dt;
      p.v.multiplyScalar(1 - dt * 1.5);
      p.p.addScaledVector(p.v, dt);
      if (p.p.y < 0.01 && p.v.y < 0) {
        p.p.y = 0.01;
        p.v.y *= -0.35;
      }
      const k = p.life / p.max;
      pos[n * 3] = p.p.x;
      pos[n * 3 + 1] = p.p.y;
      pos[n * 3 + 2] = p.p.z;
      col[n * 3] = p.c.r * k;
      col[n * 3 + 1] = p.c.g * k;
      col[n * 3 + 2] = p.c.b * k;
      size[n] = p.size * (0.5 + 0.5 * k);
      n++;
    }
    parts.geo.setDrawRange(0, n);
    parts.geo.attributes.position.needsUpdate = true;
    parts.geo.attributes.color.needsUpdate = true;
    parts.geo.attributes.size.needsUpdate = true;
  });

  return (
    <group>
      <instancedMesh ref={tracerMesh} args={[tracer.geo, tracer.mat, MAX_TRACERS]} frustumCulled={false} />
      <instancedMesh
        ref={(m) => {
          (decalMesh as React.MutableRefObject<THREE.InstancedMesh | null>).current = m;
          if (m) m.count = 0;
        }}
        args={[decals.geo, decals.mat, MAX_DECALS]}
        frustumCulled={false}
        receiveShadow
      />
      <points geometry={parts.geo} material={parts.mat} frustumCulled={false} />
      <group ref={shockGroup} />
    </group>
  );
}
