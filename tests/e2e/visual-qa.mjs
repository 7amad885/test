// Visual QA: renders the arena at a chosen preset with posed characters
// (live, echo, anomaly, ghost) and the first-person viewmodel, without a match.
// QUALITY=high BASE_URL=http://localhost:2567 node tests/e2e/visual-qa.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const BASE = process.env.BASE_URL || "http://localhost:2567";
const Q = process.env.QUALITY || "high";
const OUT = process.env.OUT || "test-results";
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: Number(process.env.W || 800), height: Number(process.env.H || 450) } });
page.on("pageerror", (e) => console.log("ERR", e.message));
await page.addInitScript((q) => localStorage.setItem("paradox-point:settings:v1", JSON.stringify({ quality: q })), Q);
await page.goto(BASE);
await page.waitForFunction(() => window.__pp?.game?.camera, null, { timeout: 60000 });
await page.evaluate(() => {
  document.querySelector(".menu-wrap")?.remove();
  const g = window.__pp.game;
  g.updateUnits = () => {};
  const mk = (id, side, kind, x, z, yaw, extra = {}) => ({ id, side, kind, name: side ? "Ember" : "Cyan", loop: 1, t: 0, x, y: 0.45, z, yaw, pitch: 0, crouch: false, ads: false, sprint: false, speed: 0, hp: 100, ...extra });
  g.units.set("a", mk("a", 1, "live", -0.9, -3.2, 0.25));
  g.units.set("b", mk("b", 0, "clone", 1.4, -4.2, -0.3, { speed: 4.5 }));
  g.units.set("c", mk("c", 1, "anomaly", -2.8, -5.5, 0.6, { crouch: true }));
  g.units.set("d", mk("d", 0, "ghost", 3.2, -6.5, -0.5));
  g.unitVersion++;
  window.__shot = "chars";
  const orig = g.applyCamera.bind(g);
  g.applyCamera = (cam, dt) => {
    if (window.__shot === "chars") {
      cam.position.set(0, 1.9, 2.2);
      cam.rotation.set(-0.12, 0, 0, "YXZ");
      cam.fov = 60;
      cam.updateProjectionMatrix();
    } else {
      cam.position.set(g.move.x, 1.62, g.move.z);
      cam.rotation.set(g.pitch, g.yaw, 0, "YXZ");
      cam.fov = 78 * (1 - 0.3 * g.adsBlend);
      cam.updateProjectionMatrix();
    }
  };
});
await page.waitForTimeout(6000);
await page.screenshot({ path: `${OUT}/qa-${Q}-characters.png`, timeout: 180000 });
// first-person viewmodel looking across the arena
await page.evaluate(() => {
  const g = window.__pp.game;
  window.__shot = "fp";
  g.units.clear();
  g.unitVersion++;
  g.phase = "loop";
  g.alive = true;
  Object.assign(g.move, { x: -14, y: 0, z: -2, vx: 0, vz: 0, onGround: true });
  g.curPos.set(-14, 0, -2);
  g.prevPos.set(-14, 0, -2);
  g.yaw = -Math.PI / 2 - 0.25;
  g.pitch = 0.02;
});
await page.waitForTimeout(4000);
await page.screenshot({ path: `${OUT}/qa-${Q}-viewmodel-hip.png`, timeout: 180000 });
await page.evaluate(() => {
  window.__pp.input.adsToggled = true;
});
await page.waitForTimeout(3000);
await page.screenshot({ path: `${OUT}/qa-${Q}-viewmodel-ads.png`, timeout: 180000 });
await page.evaluate(() => {
  window.__pp.input.adsToggled = false;
  window.__pp.game.startReload = window.__pp.game.startReload; // noop
  const g = window.__pp.game;
  g.reloading = true;
  g.reloadStart = g.now - 0.55;
  g.reloadEnd = g.now + 100;
});
await page.waitForTimeout(2000);
await page.screenshot({ path: `${OUT}/qa-${Q}-viewmodel-reload.png`, timeout: 180000 });
console.log("fps", await page.evaluate(() => window.__pp.ui.getState().fps), "quality", await page.evaluate(() => window.__pp.ui.getState().quality));
await browser.close();
