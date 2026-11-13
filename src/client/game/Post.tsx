import { Bloom, EffectComposer, N8AO } from "@react-three/postprocessing";
import { useFrame, useThree } from "@react-three/fiber";
import { BlendFunction, Effect, EffectAttribute, EffectPass } from "postprocessing";
import { useMemo } from "react";
import * as THREE from "three";
import type { QualityPreset } from "./quality";
import { game } from "./runtime";

const frag = /* glsl */ `
uniform float uRewind;
uniform float uGlitch;
uniform float uDamage;
uniform float uTime;
uniform float uExposure;
uniform float uVignette;

vec3 acesFit(vec3 x){ const float a=2.51; const float b=0.03; const float c=2.43; const float d=0.59; const float e=0.14; return clamp((x*(a*x+b))/(x*(c*x+d)+e), 0.0, 1.0); }
float hash12(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  float r = uRewind;
  float g = uGlitch;
  float amt = r + g * 0.6;
  vec2 c = uv - 0.5;
  vec3 col = inputColor.rgb;
  if (amt > 0.002) {
    vec2 st = uv;
    float d = length(c);
    float a = r * 0.55 * (1.0 - smoothstep(0.0, 0.85, d));
    float s = sin(a), co = cos(a);
    st = 0.5 + mat2(co, -s, s, co) * c * (1.0 - r * 0.06);
    float band = floor(uv.y * 38.0 + floor(uTime * 16.0));
    float tear = step(0.92, hash12(vec2(band, floor(uTime * 22.0))));
    st.x += (tear * (hash12(vec2(band, 7.0)) - 0.5) * 0.09 + sin(uv.y * 46.0 + uTime * 22.0) * 0.0025) * amt;
    vec2 dir = (st - 0.5) * (0.014 * r + 0.012 * g);
    col.r = texture2D(inputBuffer, st + dir).r;
    col.g = texture2D(inputBuffer, st).g;
    col.b = texture2D(inputBuffer, st - dir).b;
    float l0 = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = mix(col, vec3(l0) * vec3(0.72, 0.95, 1.3), r * 0.7);
    col *= 1.0 - amt * 0.2 * (0.5 + 0.5 * sin(uv.y * 900.0 + uTime * 50.0));
    col += vec3(0.25, 0.15, 0.5) * r * pow(d, 2.0);
  }
  // damage: crimson edge burn
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  float v = smoothstep(0.25, 0.85, length(c) * 1.35);
  col = mix(col, vec3(0.55, 0.0, 0.02) * (l + 0.25), v * uDamage);
  // tone map + cinematic split-tone grade
  col = acesFit(col * uExposure);
  float L = dot(col, vec3(0.299, 0.587, 0.114));
  col += vec3(-0.012, 0.004, 0.022) * (1.0 - L) + vec3(0.022, 0.008, -0.018) * L;
  col = mix(vec3(L), col, 1.06);
  col *= 1.0 - uVignette * smoothstep(0.38, 0.98, length(c * vec2(1.15, 1.0)) * 1.3);
  col += (hash12(uv * 1000.0 + fract(uTime)) - 0.5) * 0.016;
  outputColor = vec4(clamp(col, 0.0, 1.0), inputColor.a);
}
`;

class TemporalEffect extends Effect {
  constructor() {
    super("TemporalEffect", frag, {
      blendFunction: BlendFunction.SET,
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map<string, THREE.Uniform>([
        ["uRewind", new THREE.Uniform(0)],
        ["uGlitch", new THREE.Uniform(0)],
        ["uDamage", new THREE.Uniform(0)],
        ["uTime", new THREE.Uniform(0)],
        ["uExposure", new THREE.Uniform(1.05)],
        ["uVignette", new THREE.Uniform(0.5)],
      ]),
    });
  }
}

export function Post({ q }: { q: QualityPreset }) {
  const camera = useThree((s) => s.camera);
  const effect = useMemo(() => new TemporalEffect(), []);
  const pass = useMemo(() => new EffectPass(camera, effect), [camera, effect]);
  useFrame((_, dt) => {
    const u = effect.uniforms;
    const rw = game.phase === "rewind" ? Math.sin(Math.min(1, game.rewindProgress * 1.05) * Math.PI) * 0.85 + 0.15 : 0;
    const cur = u.get("uRewind")!.value as number;
    u.get("uRewind")!.value = cur + (rw - cur) * Math.min(1, dt * 8);
    u.get("uGlitch")!.value = Math.min(1, game.glitch);
    const lowHp = game.alive && game.hp < 35 ? (1 - game.hp / 35) * (0.35 + 0.15 * Math.sin(game.now * 6)) : 0;
    u.get("uDamage")!.value = Math.min(0.9, game.damageFlash * 0.8 + lowHp);
    u.get("uTime")!.value = game.now % 1000;
  });
  return (
    <EffectComposer multisampling={q.msaa} enableNormalPass={false}>
      {q.ao ? <N8AO halfRes={q.aoHalfRes} aoRadius={1.4} intensity={2.4} distanceFalloff={0.8} quality={q.aoHalfRes ? "performance" : "medium"} /> : <></>}
      {q.bloom ? <Bloom mipmapBlur intensity={0.9} luminanceThreshold={0.95} luminanceSmoothing={0.25} radius={0.72} /> : <></>}
      <primitive object={pass} />
    </EffectComposer>
  );
}
