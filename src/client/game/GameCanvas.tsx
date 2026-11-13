import { PerformanceMonitor } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { input } from "../input/InputManager";
import { useUI, type QualityName } from "../store";
import { Arena } from "./Arena";
import { Characters } from "./Characters";
import { Effects } from "./Effects";
import { Post } from "./Post";
import { detectQuality, ORDER, PRESETS } from "./quality";
import { game } from "./runtime";
import { sharedTime } from "./shaders";
import { Weapon } from "./Weapon";

function Loop() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const fps = useRef({ frames: 0, t: 0 });
  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    sharedTime.value += dt;
    game.frame(dt, camera);
    const f = fps.current;
    f.frames++;
    f.t += rawDt;
    if (f.t > 0.5) {
      useUI.setState({ fps: Math.round(f.frames / f.t) });
      f.frames = 0;
      f.t = 0;
    }
  }, -10);
  return null;
}

function ToneMappingSync({ post }: { post: boolean }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    gl.toneMapping = post ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = 1.05;
    scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (!m) return;
      (Array.isArray(m) ? m : [m]).forEach((x) => (x.needsUpdate = true));
    });
  }, [gl, scene, post]);
  return null;
}

function InputAttach() {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    input.attach(gl.domElement);
  }, [gl]);
  return null;
}

export function GameCanvas() {
  const settings = useUI((s) => s.settings);
  const quality = useUI((s) => s.quality);
  const setQuality = useUI((s) => s.setQuality);
  const initial = useMemo<QualityName>(() => detectQuality(), []);
  const [dprFactor, setDprFactor] = useState(1);

  useEffect(() => {
    setQuality(settings.quality === "auto" ? initial : settings.quality);
  }, [settings.quality, initial, setQuality]);

  useEffect(() => game.init(), []);

  const q = PRESETS[quality];
  const auto = settings.quality === "auto";
  const step = (dir: 1 | -1) => {
    if (!auto) return;
    const i = ORDER.indexOf(useUI.getState().quality);
    const max = Math.min(ORDER.length - 1, ORDER.indexOf(initial) + 1);
    const ni = Math.max(0, Math.min(max, i + dir));
    if (ni !== i) setQuality(ORDER[ni]);
  };
  const dpr: [number, number] = [q.dpr[0], Math.max(q.dpr[0], q.dpr[1] * dprFactor)];

  return (
    <Canvas
      key={q.shadows ? "s" : "n"}
      shadows={q.shadows}
      dpr={dpr}
      gl={{ antialias: !q.post && quality !== "low", powerPreference: "high-performance", stencil: false, alpha: false }}
      camera={{ fov: 78, near: 0.02, far: 700, position: [0, 10, 22] }}
      style={{ position: "fixed", inset: 0, touchAction: "none" }}
      onCreated={({ gl }) => {
        gl.outputColorSpace = THREE.SRGBColorSpace;
      }}
    >
      <color attach="background" args={["#05080d"]} />
      {q.fog && <fogExp2 attach="fog" args={["#0b111b", 0.0105]} />}
      <ToneMappingSync post={q.post} />
      <InputAttach />
      <Loop />
      <PerformanceMonitor
        bounds={(refresh) => (refresh > 90 ? [50, 90] : [44, 58])}
        flipflops={4}
        onIncline={() => {
          setDprFactor(1);
          step(1);
        }}
        onDecline={() => {
          setDprFactor((f) => Math.max(0.7, f - 0.15));
          step(-1);
        }}
      />
      <Suspense fallback={null}>
        <Arena q={q} />
        <Characters />
        <Effects q={q} />
        <Weapon />
        {q.post && <Post q={q} />}
      </Suspense>
    </Canvas>
  );
}
