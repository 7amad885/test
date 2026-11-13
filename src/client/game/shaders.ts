// Custom GLSL materials for the temporal look of the game.

import * as THREE from "three";

export const sharedTime = { value: 0 };

/**
 * Temporal hologram used for historical units.
 * mode 0 = clone (stable echo), 1 = anomaly (rescued, glitching),
 * 2 = ghost (erased, dissolving), 3 = rewind trace.
 */
export function makeHoloMaterial(color: THREE.ColorRepresentation, mode: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uTime: sharedTime,
      uMode: { value: mode },
      uFade: { value: 1 },
      uSeed: { value: Math.random() * 10 },
    },
    vertexShader: /* glsl */ `
      uniform float uTime; uniform float uMode; uniform float uSeed;
      varying vec3 vN; varying vec3 vV; varying vec3 vW;
      float h(float n){ return fract(sin(n)*43758.5453); }
      void main(){
        vec4 w = modelMatrix * vec4(position,1.0);
        // anomaly: horizontal slice displacement
        if (uMode > 0.5 && uMode < 1.5) {
          float band = floor(w.y * 9.0 + floor(uTime*14.0));
          float r = h(band + uSeed);
          w.x += step(0.82, r) * (r - 0.9) * 0.6;
          w.z += step(0.9, h(band*1.7+uSeed)) * 0.15;
        }
        if (uMode > 1.5 && uMode < 2.5) {
          w.y += sin(w.x*6.0+uTime*3.0)*0.02;
        }
        vW = w.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        vV = normalize(cameraPosition - w.xyz);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uTime; uniform float uMode; uniform float uFade; uniform float uSeed;
      varying vec3 vN; varying vec3 vV; varying vec3 vW;
      float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
      void main(){
        float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
        float scan = 0.55 + 0.45 * sin(vW.y * 70.0 - uTime * 7.0);
        float bands = smoothstep(0.92, 1.0, sin(vW.y * 3.0 - uTime * 2.5) * 0.5 + 0.5);
        vec3 col = uColor;
        float a = (0.14 + fres * 0.9) * scan + bands * 0.35;
        float flick = 0.88 + 0.12 * sin(uTime * 37.0 + uSeed * 10.0);
        if (uMode > 0.5 && uMode < 1.5) {
          // anomaly: gold/violet instability
          float g = step(0.5, h(vec2(floor(vW.y*20.0), floor(uTime*10.0))));
          col = mix(vec3(1.0,0.82,0.35), vec3(0.75,0.4,1.0), g);
          col = mix(col, uColor, 0.35);
          flick = 0.7 + 0.3 * h(vec2(floor(uTime*24.0), uSeed));
          a *= 1.3;
        } else if (uMode > 1.5 && uMode < 2.5) {
          // ghost: dissolve
          float n = h(floor(vW.xy*18.0) + floor(vW.zy*18.0));
          if (n > uFade) discard;
          col = mix(vec3(1.0,0.3,0.4), uColor, 0.4);
          a *= 0.55 * uFade;
        } else if (uMode > 2.5) {
          col = mix(uColor, vec3(0.75,0.7,1.0), 0.5);
          a *= 0.7;
        }
        gl_FragColor = vec4(col * (1.4 + fres * 2.0) * flick, clamp(a * flick, 0.0, 1.0) * uFade);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.FrontSide,
  });
}

/** Capture zone: animated ring + floor glyphs showing meter and state. */
export function makeCaptureMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: sharedTime,
      uMeter: { value: 0 },
      uState: { value: -1 },
      uC0: { value: new THREE.Color("#2fd8ff") },
      uC1: { value: new THREE.Color("#ff7a2a") },
    },
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform float uMeter; uniform float uState; uniform vec3 uC0; uniform vec3 uC1;
      varying vec2 vUv;
      #define PI 3.14159265
      void main(){
        vec2 p = (vUv - 0.5) * 2.0;
        float r = length(p);
        float ang = atan(p.y, p.x);
        float a01 = fract(ang / (2.0*PI) + 0.25);
        vec3 neutral = vec3(0.75, 0.85, 1.0);
        float m = clamp(abs(uMeter), 0.0, 1.0);
        vec3 owner = uMeter >= 0.0 ? uC0 : uC1;
        // outer progress ring
        float ring = smoothstep(0.93, 0.95, r) * (1.0 - smoothstep(0.985, 1.0, r));
        float filled = step(a01, m);
        vec3 col = mix(neutral * 0.25, owner * 1.6, filled) * ring;
        float alpha = ring * (0.5 + filled * 0.5);
        // ticks
        float ticks = step(0.86, r) * (1.0 - step(0.9, r)) * step(0.7, fract(a01 * 48.0));
        col += neutral * ticks * 0.5; alpha += ticks * 0.4;
        // inner rotating glyph ring
        float g = step(0.62, r) * (1.0 - step(0.66, r)) * step(0.5, fract((ang + uTime*0.4) * 6.0 / PI));
        vec3 stateCol = uState < -0.5 ? neutral : (uState > 1.5 ? mix(vec3(1.0,0.2,0.3), vec3(1.0), step(0.5, fract(uTime*4.0))) : (uState < 0.5 ? uC0 : uC1));
        col += stateCol * g * 0.9; alpha += g * 0.6;
        // pulses moving inward while capturing
        float pulse = 0.0;
        if (uState > -0.5) pulse = smoothstep(0.03, 0.0, abs(fract(r - uTime*0.6) - 0.5)) * step(r, 0.9);
        col += stateCol * pulse * 0.6; alpha += pulse * 0.4;
        // centre hourglass glyph
        float hg = smoothstep(0.02, 0.0, abs(abs(p.x) - abs(p.y)*0.6) - 0.012) * step(r, 0.42);
        col += owner * hg * (0.4 + m); alpha += hg * 0.5;
        gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
}

/** Fake volumetric light shaft (open cone/cylinder). */
export function makeBeamMaterial(color: THREE.ColorRepresentation, intensity = 1): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uTime: sharedTime, uI: { value: intensity } },
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){ vUv = uv; vec4 w = modelMatrix*vec4(position,1.0);
        vN = normalize(mat3(modelMatrix)*normal); vV = normalize(cameraPosition - w.xyz);
        gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uTime; uniform float uI;
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){
        float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.6);
        float fall = pow(vUv.y, 1.4);
        float dust = 0.75 + 0.25 * sin(vUv.y * 40.0 - uTime * 2.0 + vUv.x * 30.0);
        float a = edge * fall * dust * 0.22 * uI;
        gl_FragColor = vec4(uColor * a * 2.0, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

export function makeSkyMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: sharedTime },
    vertexShader: /* glsl */ `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix*modelViewMatrix*vec4(position,1.0); gl_Position = p.xyww; }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; varying vec3 vDir;
      float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719)))*43758.5453); }
      void main(){
        vec3 d = normalize(vDir);
        float y = d.y;
        vec3 horizon = vec3(0.10, 0.13, 0.20);
        vec3 zenith = vec3(0.008, 0.012, 0.03);
        vec3 col = mix(horizon, zenith, smoothstep(-0.05, 0.55, y));
        // city glow at the horizon
        col += vec3(0.35, 0.18, 0.08) * exp(-max(y,0.0)*14.0) * 0.5;
        col += vec3(0.05, 0.22, 0.3) * exp(-abs(y-0.02)*30.0) * 0.4;
        // temporal rift band across the sky
        float band = exp(-pow((d.y - 0.45 - 0.08*sin(d.x*3.0+uTime*0.05))*7.0, 2.0));
        col += mix(vec3(0.15,0.05,0.35), vec3(0.0,0.35,0.45), 0.5+0.5*sin(d.x*4.0 + uTime*0.1)) * band * 0.35;
        // stars
        vec3 sp = floor(d * 380.0);
        float s = step(0.9975, h(sp)) * smoothstep(0.05, 0.3, y);
        col += vec3(0.9,0.95,1.0) * s * (0.6 + 0.4*sin(uTime*2.0 + h(sp)*30.0));
        gl_FragColor = vec4(col, 1.0);
      }`,
    side: THREE.BackSide,
    depthWrite: false,
  });
}

export function makeShockMaterial(color: THREE.ColorRepresentation): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uP: { value: 0 } },
    vertexShader: /* glsl */ `varying vec3 vN; varying vec3 vV; void main(){ vec4 w = modelMatrix*vec4(position,1.0); vN = normalize(mat3(modelMatrix)*normal); vV = normalize(cameraPosition-w.xyz); gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: /* glsl */ `uniform vec3 uColor; uniform float uP; varying vec3 vN; varying vec3 vV;
      void main(){ float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 3.0); float a = f * (1.0 - uP); gl_FragColor = vec4(uColor * a * 3.0, a); }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}
