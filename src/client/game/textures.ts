// Procedurally generated, seamless PBR texture sets and effect sprites.
// Everything is generated at runtime (original content, no third-party assets).

import * as THREE from "three";

export type SurfaceKind = "concrete" | "metal" | "darkmetal" | "floor" | "crate" | "armor" | "gunmetal";

export interface PBRSet {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  /** G = roughness, B = metalness (three.js convention) */
  ormMap: THREE.Texture;
}

const cache = new Map<string, unknown>();

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

/** Tileable value-noise fBm in [0,1]. */
function fbm(size: number, basePeriod: number, octaves: number, seed: number, stretchX = 1): Float32Array {
  const out = new Float32Array(size * size);
  let amp = 1,
    total = 0;
  for (let o = 0; o < octaves; o++) {
    const period = basePeriod << o;
    const px = Math.max(1, Math.round(period / stretchX));
    const r = rng(seed + o * 7919);
    const grid = new Float32Array(px * period);
    for (let i = 0; i < grid.length; i++) grid[i] = r();
    for (let y = 0; y < size; y++) {
      const fy = (y / size) * period;
      const y0 = Math.floor(fy);
      let ty = fy - y0;
      ty = ty * ty * (3 - 2 * ty);
      const ya = (y0 % period) * px,
        yb = ((y0 + 1) % period) * px;
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * px;
        const x0 = Math.floor(fx);
        let tx = fx - x0;
        tx = tx * tx * (3 - 2 * tx);
        const xa = x0 % px,
          xb = (x0 + 1) % px;
        const v = grid[ya + xa] * (1 - tx) * (1 - ty) + grid[ya + xb] * tx * (1 - ty) + grid[yb + xa] * (1 - tx) * ty + grid[yb + xb] * tx * ty;
        out[y * size + x] += v * amp;
      }
    }
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

function toTexture(canvas: HTMLCanvasElement, srgb: boolean, anisotropy: number): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = anisotropy;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

function canvas(size: number) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  return c;
}

function normalFromHeight(h: Float32Array, size: number, strength: number): HTMLCanvasElement {
  const c = canvas(size);
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const l = h[y * size + ((x - 1 + size) % size)];
      const r = h[y * size + ((x + 1) % size)];
      const u = h[((y - 1 + size) % size) * size + x];
      const b = h[((y + 1) % size) * size + x];
      let nx = (l - r) * strength;
      let ny = (b - u) * strength;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      nz /= len;
      const i = (y * size + x) * 4;
      d[i] = (nx * 0.5 + 0.5) * 255;
      d[i + 1] = (ny * 0.5 + 0.5) * 255;
      d[i + 2] = (nz * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

interface SurfaceParams {
  base: [number, number, number];
  tint2: [number, number, number];
  rough: [number, number];
  metal: number;
  panels: number; // panel grid count per texture (0 = none)
  seam: number;
  rivets: boolean;
  brushed: boolean;
  grime: number;
  scratches: number;
  heightScale: number;
  stencil?: string;
  formwork?: boolean;
}

const PARAMS: Record<SurfaceKind, SurfaceParams> = {
  concrete: { base: [150, 152, 154], tint2: [112, 114, 118], rough: [0.78, 0.96], metal: 0, panels: 2, seam: 0.006, rivets: false, brushed: false, grime: 0.55, scratches: 0, heightScale: 3.5, formwork: true },
  metal: { base: [128, 136, 146], tint2: [92, 100, 110], rough: [0.26, 0.5], metal: 0.92, panels: 2, seam: 0.008, rivets: true, brushed: true, grime: 0.3, scratches: 60, heightScale: 2.5 },
  darkmetal: { base: [58, 63, 70], tint2: [38, 42, 48], rough: [0.3, 0.6], metal: 0.85, panels: 4, seam: 0.01, rivets: true, brushed: false, grime: 0.35, scratches: 40, heightScale: 3 },
  floor: { base: [70, 76, 84], tint2: [46, 50, 56], rough: [0.22, 0.62], metal: 0.55, panels: 4, seam: 0.007, rivets: false, brushed: false, grime: 0.7, scratches: 80, heightScale: 2.2 },
  crate: { base: [84, 92, 100], tint2: [60, 66, 72], rough: [0.42, 0.65], metal: 0.6, panels: 1, seam: 0.035, rivets: true, brushed: false, grime: 0.45, scratches: 30, heightScale: 4, stencil: "PX-07 // CHRONO CARGO" },
  armor: { base: [70, 76, 84], tint2: [50, 54, 60], rough: [0.35, 0.6], metal: 0.6, panels: 2, seam: 0.006, rivets: false, brushed: false, grime: 0.25, scratches: 25, heightScale: 1.5 },
  gunmetal: { base: [52, 56, 62], tint2: [36, 39, 44], rough: [0.25, 0.48], metal: 0.9, panels: 0, seam: 0, rivets: false, brushed: true, grime: 0.15, scratches: 50, heightScale: 1.2 },
};

export function surface(kind: SurfaceKind, size: number, anisotropy = 4): PBRSet {
  const key = `${kind}:${size}:${anisotropy}`;
  const hit = cache.get(key) as PBRSet | undefined;
  if (hit) return hit;
  const P = PARAMS[kind];
  const seed = kind.length * 1013 + size;
  const large = fbm(size, 3, 4, seed);
  const fine = fbm(size, 32, 3, seed + 99);
  const brush = P.brushed ? fbm(size, 64, 2, seed + 5, 16) : null;
  const grime = fbm(size, 6, 4, seed + 333);
  const height = new Float32Array(size * size);
  const albedo = canvas(size);
  const actx = albedo.getContext("2d")!;
  const aimg = actx.createImageData(size, size);
  const orm = canvas(size);
  const octx = orm.getContext("2d")!;
  const oimg = octx.createImageData(size, size);
  const r = rng(seed + 17);

  // Panel seams and rivets mask
  const seamMask = new Float32Array(size * size);
  if (P.panels > 0) {
    const cell = size / P.panels;
    const sw = Math.max(1, P.seam * size);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const cx = x % cell,
          cy = y % cell;
        const dEdge = Math.min(cx, cell - cx, cy, cell - cy);
        let m = dEdge < sw ? 1 : dEdge < sw * 2.2 ? 0.35 : 0;
        if (P.formwork) m *= 0.8;
        if (P.rivets) {
          const ins = sw * 4.5;
          for (const [rx, ry] of [
            [ins, ins],
            [cell - ins, ins],
            [ins, cell - ins],
            [cell - ins, cell - ins],
          ]) {
            const dd = Math.hypot(cx - rx, cy - ry);
            if (dd < sw * 1.6) m = -1 + dd / (sw * 1.6); // raised bolt
          }
        }
        if (P.formwork) {
          // tie-rod holes typical of architectural concrete
          const hx = cell * 0.25,
            hy = cell * 0.25;
          for (const [rx, ry] of [
            [hx, hy],
            [cell - hx, hy],
            [hx, cell - hy],
            [cell - hx, cell - hy],
          ]) {
            const dd = Math.hypot(cx - rx, cy - ry);
            if (dd < size * 0.012) m = Math.max(m, 1 - dd / (size * 0.012));
          }
        }
        seamMask[y * size + x] = m;
      }
  }

  // Scratches
  const scratch = new Float32Array(size * size);
  for (let i = 0; i < P.scratches; i++) {
    let x = r() * size,
      y = r() * size;
    const a = r() * Math.PI * 2;
    const len = (0.02 + r() * 0.08) * size;
    for (let s = 0; s < len; s++) {
      x += Math.cos(a) + (r() - 0.5) * 0.3;
      y += Math.sin(a) + (r() - 0.5) * 0.3;
      const ix = ((Math.floor(x) % size) + size) % size,
        iy = ((Math.floor(y) % size) + size) % size;
      scratch[iy * size + ix] = 0.6 + r() * 0.4;
    }
  }

  for (let i = 0; i < size * size; i++) {
    const L = large[i],
      F = fine[i],
      G = grime[i];
    const seam = seamMask[i];
    const b = brush ? brush[i] : 0.5;
    let h = F * 0.6 + L * 0.4;
    if (seam > 0) h -= seam * 0.9;
    else if (seam < 0) h += -seam * 0.8;
    h += (brush ? (b - 0.5) * 0.15 : 0) - scratch[i] * 0.15;
    height[i] = h;

    const grimeAmt = Math.max(0, (G - (1 - P.grime)) / P.grime) * P.grime;
    let mix = Math.min(1, Math.max(0, L * 1.2 - 0.1));
    if (P.formwork) mix = Math.min(1, mix + (F - 0.5) * 0.6);
    let cr = P.base[0] * (1 - mix) + P.tint2[0] * mix;
    let cg = P.base[1] * (1 - mix) + P.tint2[1] * mix;
    let cb = P.base[2] * (1 - mix) + P.tint2[2] * mix;
    const grain = 0.88 + F * 0.24 + (brush ? (b - 0.5) * 0.18 : 0);
    cr *= grain;
    cg *= grain;
    cb *= grain;
    const dark = 1 - grimeAmt * 0.55 - Math.max(0, seam) * 0.45;
    cr *= dark;
    cg *= dark;
    cb *= dark * 0.97;
    const sc = scratch[i] * 70;
    const idx = i * 4;
    aimg.data[idx] = Math.min(255, cr + sc);
    aimg.data[idx + 1] = Math.min(255, cg + sc);
    aimg.data[idx + 2] = Math.min(255, cb + sc);
    aimg.data[idx + 3] = 255;

    let rough = P.rough[0] + (P.rough[1] - P.rough[0]) * (L * 0.5 + G * 0.5);
    rough += grimeAmt * 0.25 - scratch[i] * 0.15 + Math.max(0, seam) * 0.2;
    // puddle-like glossy patches on the floor for reflections
    if (kind === "floor" && L > 0.62) rough *= 0.45;
    oimg.data[idx] = 255;
    oimg.data[idx + 1] = Math.max(0, Math.min(1, rough)) * 255;
    oimg.data[idx + 2] = Math.max(0, Math.min(1, P.metal - grimeAmt * 0.3 + scratch[i] * 0.1)) * 255;
    oimg.data[idx + 3] = 255;
  }
  actx.putImageData(aimg, 0, 0);
  octx.putImageData(oimg, 0, 0);

  if (P.stencil) {
    actx.save();
    actx.globalAlpha = 0.55;
    actx.fillStyle = "#d9dde2";
    actx.font = `bold ${Math.round(size * 0.055)}px "Arial Narrow", Arial, sans-serif`;
    actx.fillText(P.stencil, size * 0.12, size * 0.82);
    actx.fillStyle = "#e3a23b";
    for (let i = 0; i < 6; i++) {
      actx.beginPath();
      const x0 = size * 0.12 + i * size * 0.06;
      actx.moveTo(x0, size * 0.18);
      actx.lineTo(x0 + size * 0.03, size * 0.18);
      actx.lineTo(x0 + size * 0.07, size * 0.12);
      actx.lineTo(x0 + size * 0.04, size * 0.12);
      actx.fill();
    }
    actx.restore();
  }
  if (kind === "floor") {
    // painted lane markings
    actx.save();
    actx.globalAlpha = 0.25;
    actx.fillStyle = "#c9d3dd";
    actx.fillRect(0, size * 0.495, size, size * 0.01);
    actx.restore();
  }

  const set: PBRSet = {
    map: toTexture(albedo, true, anisotropy),
    normalMap: toTexture(normalFromHeight(height, size, P.heightScale), false, anisotropy),
    ormMap: toTexture(orm, false, anisotropy),
  };
  cache.set(key, set);
  return set;
}

// ---------------------------------------------------------------- sprites

function sprite(key: string, size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void): THREE.Texture {
  const hit = cache.get(key) as THREE.Texture | undefined;
  if (hit) return hit;
  const c = canvas(size);
  const ctx = c.getContext("2d")!;
  draw(ctx, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, t);
  return t;
}

export const glowTexture = () =>
  sprite("glow", 128, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.25, "rgba(255,255,255,0.55)");
    g.addColorStop(0.6, "rgba(255,255,255,0.12)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });

export const flashTexture = () =>
  sprite("flash", 256, (ctx, s) => {
    const c = s / 2;
    ctx.translate(c, c);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, c);
    g.addColorStop(0, "rgba(255,255,240,1)");
    g.addColorStop(0.2, "rgba(255,220,150,0.9)");
    g.addColorStop(0.5, "rgba(255,140,40,0.35)");
    g.addColorStop(1, "rgba(255,90,0,0)");
    ctx.fillStyle = g;
    for (let i = 0; i < 7; i++) {
      ctx.rotate((Math.PI * 2) / 7 + (i % 2) * 0.2);
      ctx.beginPath();
      ctx.moveTo(0, -c * 0.12);
      ctx.lineTo(c * (0.75 + (i % 3) * 0.08), 0);
      ctx.lineTo(0, c * 0.12);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(0, 0, c * 0.4, 0, Math.PI * 2);
    ctx.fill();
  });

export const flashSideTexture = () =>
  sprite("flashside", 256, (ctx, s) => {
    const g = ctx.createLinearGradient(0, 0, s, 0);
    g.addColorStop(0, "rgba(255,255,230,1)");
    g.addColorStop(0.35, "rgba(255,190,90,0.8)");
    g.addColorStop(1, "rgba(255,90,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, s * 0.4);
    ctx.quadraticCurveTo(s * 0.5, s * 0.2, s, s * 0.5);
    ctx.quadraticCurveTo(s * 0.5, s * 0.8, 0, s * 0.6);
    ctx.fill();
  });

export const holeTexture = () =>
  sprite("hole", 64, (ctx, s) => {
    const c = s / 2;
    const g = ctx.createRadialGradient(c, c, 0, c, c, c);
    g.addColorStop(0, "rgba(5,5,6,1)");
    g.addColorStop(0.18, "rgba(10,10,12,0.95)");
    g.addColorStop(0.32, "rgba(40,38,36,0.7)");
    g.addColorStop(0.6, "rgba(30,30,30,0.25)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = "rgba(15,15,15,0.6)";
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + Math.random();
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(a) * s * 0.12, c + Math.sin(a) * s * 0.12);
      ctx.lineTo(c + Math.cos(a) * s * (0.25 + Math.random() * 0.2), c + Math.sin(a) * s * (0.25 + Math.random() * 0.2));
      ctx.stroke();
    }
  });

export const smokeTexture = () =>
  sprite("smoke", 128, (ctx, s) => {
    const n = fbm(s, 4, 4, 77);
    const img = ctx.createImageData(s, s);
    for (let y = 0; y < s; y++)
      for (let x = 0; x < s; x++) {
        const d = Math.hypot(x - s / 2, y - s / 2) / (s / 2);
        const a = Math.max(0, 1 - d) ** 1.5 * (0.4 + n[y * s + x] * 0.8);
        const i = (y * s + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 220;
        img.data[i + 3] = Math.min(255, a * 255);
      }
    ctx.putImageData(img, 0, 0);
  });

export const windowsTexture = () =>
  sprite("windows", 512, (ctx, s) => {
    ctx.fillStyle = "#020306";
    ctx.fillRect(0, 0, s, s);
    const r = rng(42);
    const cols = 12,
      rows = 40;
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        if (r() < 0.78) continue;
        const warm = r() < 0.6;
        const b = 0.35 + r() * 0.65;
        ctx.fillStyle = warm ? `rgba(255,${170 + r() * 50},${90 + r() * 40},${b})` : `rgba(${120 + r() * 60},${200 + r() * 55},255,${b})`;
        ctx.fillRect((x / cols) * s + 2, (y / rows) * s + 2, s / cols - 4, s / rows - 3);
      }
  });

export const holoSignTexture = (text: string, color: string) =>
  sprite(`holo:${text}:${color}`, 1024, (ctx, s) => {
    ctx.clearRect(0, 0, s, s);
    const h = s / 4;
    ctx.save();
    ctx.translate(0, s / 2 - h / 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 6;
    ctx.globalAlpha = 0.9;
    ctx.strokeRect(12, 12, s - 24, h - 24);
    ctx.globalAlpha = 0.35;
    ctx.strokeRect(28, 28, s - 56, h - 56);
    ctx.globalAlpha = 1;
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 24;
    ctx.font = `900 ${Math.round(h * 0.42)}px "Segoe UI", Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, s / 2, h / 2 + 4);
    ctx.restore();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = "#000";
    for (let y = 0; y < s; y += 6) ctx.fillRect(0, y, s, 2);
  });

export const ringTexture = () =>
  sprite("ring", 512, (ctx, s) => {
    const c = s / 2;
    ctx.translate(c, c);
    ctx.strokeStyle = "white";
    for (let i = 0; i < 3; i++) {
      ctx.globalAlpha = [1, 0.5, 0.25][i];
      ctx.lineWidth = [10, 4, 2][i];
      ctx.beginPath();
      ctx.arc(0, 0, c * (0.94 - i * 0.07), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 0.8;
    for (let i = 0; i < 60; i++) {
      ctx.rotate((Math.PI * 2) / 60);
      ctx.fillRect(c * 0.72, -2, i % 5 === 0 ? c * 0.1 : c * 0.05, 4);
    }
  });

/** Text label rendered to a texture (nameplates). */
export function labelTexture(text: string, color: string, sub?: string): THREE.CanvasTexture {
  const c = canvas(256);
  c.height = 64;
  const ctx = c.getContext("2d")!;
  ctx.font = `700 26px "Segoe UI", Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.shadowColor = "rgba(0,0,0,0.9)";
  ctx.shadowBlur = 6;
  ctx.fillStyle = color;
  ctx.fillText(text, 128, sub ? 28 : 40);
  if (sub) {
    ctx.font = `600 18px "Segoe UI", Arial, sans-serif`;
    ctx.fillStyle = "rgba(230,240,255,0.85)";
    ctx.fillText(sub, 128, 54);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
