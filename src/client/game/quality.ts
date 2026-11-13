// Graphics presets and automatic device-tier detection.

import type { QualityName } from "../store";

export interface QualityPreset {
  name: QualityName;
  dpr: [number, number];
  shadows: boolean;
  shadowMap: number;
  post: boolean;
  bloom: boolean;
  ao: boolean;
  aoHalfRes: boolean;
  msaa: number;
  reflector: number; // 0 = off, else resolution
  texSize: number;
  particles: number; // multiplier
  pointLights: number;
  envRes: number;
  fog: boolean;
  anisotropy: number;
}

export const PRESETS: Record<QualityName, QualityPreset> = {
  low: {
    name: "low",
    dpr: [0.6, 1],
    shadows: false,
    shadowMap: 512,
    post: false,
    bloom: false,
    ao: false,
    aoHalfRes: true,
    msaa: 0,
    reflector: 0,
    texSize: 256,
    particles: 0.3,
    pointLights: 0,
    envRes: 64,
    fog: true,
    anisotropy: 1,
  },
  medium: {
    name: "medium",
    dpr: [0.8, 1.25],
    shadows: true,
    shadowMap: 1024,
    post: true,
    bloom: true,
    ao: false,
    aoHalfRes: true,
    msaa: 0,
    reflector: 0,
    texSize: 512,
    particles: 0.6,
    pointLights: 2,
    envRes: 128,
    fog: true,
    anisotropy: 4,
  },
  high: {
    name: "high",
    dpr: [1, 1.6],
    shadows: true,
    shadowMap: 2048,
    post: true,
    bloom: true,
    ao: true,
    aoHalfRes: true,
    msaa: 2,
    reflector: 512,
    texSize: 1024,
    particles: 1,
    pointLights: 4,
    envRes: 256,
    fog: true,
    anisotropy: 8,
  },
  ultra: {
    name: "ultra",
    dpr: [1.25, 2],
    shadows: true,
    shadowMap: 4096,
    post: true,
    bloom: true,
    ao: true,
    aoHalfRes: false,
    msaa: 4,
    reflector: 1024,
    texSize: 1024,
    particles: 1.4,
    pointLights: 6,
    envRes: 512,
    fog: true,
    anisotropy: 16,
  },
};

export const ORDER: QualityName[] = ["low", "medium", "high", "ultra"];

export function isMobileDevice(): boolean {
  const ua = navigator.userAgent;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua));
}

/** Heuristic first guess; the runtime FPS monitor refines it. */
export function detectQuality(): QualityName {
  const mobile = isMobileDevice();
  let gpu = "";
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2") || c.getContext("webgl");
    if (gl) {
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      gpu = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)).toLowerCase();
    }
  } catch {
    /* ignore */
  }
  const cores = navigator.hardwareConcurrency || 4;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory || 4;
  if (/swiftshader|llvmpipe|software|basic render/.test(gpu)) return "low";
  if (mobile) {
    if (/apple/.test(gpu) || /iphone|ipad/i.test(navigator.userAgent)) return cores >= 6 ? "medium" : "low";
    const adreno = gpu.match(/adreno[^\d]*(\d{3})/);
    if (adreno) return Number(adreno[1]) >= 730 ? "high" : Number(adreno[1]) >= 640 ? "medium" : "low";
    const mali = gpu.match(/mali-g(\d+)/);
    if (mali) return Number(mali[1]) >= 710 ? "medium" : "low";
    if (/xclipse|immortalis/.test(gpu)) return "high";
    return mem >= 6 ? "medium" : "low";
  }
  if (/nvidia|geforce|rtx|radeon rx|radeon pro|arc a/.test(gpu)) return "ultra";
  if (/apple m\d|apple gpu/.test(gpu)) return "high";
  if (/intel/.test(gpu)) return cores >= 8 ? "medium" : "low";
  return "high";
}
