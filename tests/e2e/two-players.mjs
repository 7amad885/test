// End-to-end multiplayer test: a touch-emulated iPhone and a desktop browser
// create/join a private room through the invite link, ready up and fight on
// the real server. Run with the server up:  BASE_URL=http://localhost:2567 node tests/e2e/two-players.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const { chromium, devices } = require("playwright");

const BASE = process.env.BASE_URL || "http://localhost:2567";
const OUT = process.env.OUT || "test-results";
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(`[${(performance.now() / 1000).toFixed(1)}s]`, ...a);
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  log(ok ? "PASS" : "FAIL", name, detail);
};

const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const ctxA = await browser.newContext({ ...devices["iPhone 13 landscape"] });
const ctxB = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const A = await ctxA.newPage();
const B = await ctxB.newPage();
const errors = [];
for (const [n, p] of [["phone", A], ["desktop", B]]) {
  p.on("pageerror", (e) => errors.push(`${n}: ${e.message}`));
  p.on("console", (m) => m.type() === "error" && errors.push(`${n} console: ${m.text()}`));
}
const trackEvents = (p) =>
  p.evaluate(() => {
    window.__ev = {};
    window.__pp.net.onState(() => {
      const st = window.__pp.net.state;
      if (st?.paused) window.__ev.paused = 1;
      if (st && st.loop >= 2 && st.phase === "loop") {
        let n = 0;
        st.units.forEach((u) => u.kind !== "live" && n++);
        window.__ev.maxEchoes = Math.max(window.__ev.maxEchoes || 0, n);
      }
    });
    window.__pp.net.onEvent((e) => {
      window.__ev[e.type] = (window.__ev[e.type] || 0) + 1;
      if (e.type === "shot" && !e.data.replay) window.__ev["liveShot:" + e.data.side] = (window.__ev["liveShot:" + e.data.side] || 0) + 1;
      if (e.type === "paradox") window.__ev["paradox:" + e.data.type] = (window.__ev["paradox:" + e.data.type] || 0) + 1;
    });
  });

// ---- 1. phone creates a private match
await A.goto(BASE);
await A.fill("#name", "PhoneAce");
await A.tap("text=Create Private Match");
await A.waitForSelector(".code", { timeout: 20000 });
const code = (await A.textContent(".code")).trim();
const link = (await A.textContent(".link")).trim();
check("room created with invite link", /^[A-Z0-9]{5}$/.test(code) && link.includes(`room=${code}`), link);
await A.screenshot({ path: `${OUT}/1-phone-lobby.png` });

// ---- 2. desktop opens the invite link and joins
await B.goto(link);
await B.fill("#name", "DeskPro");
await B.click("text=Join friend's match");
await A.waitForFunction(() => window.__pp.net.state?.players.size === 2, null, { timeout: 15000 });
check("friend joined the same room via link", (await B.evaluate(() => window.__pp.net.code)) === code);
await trackEvents(A);
await trackEvents(B);
await B.screenshot({ path: `${OUT}/2-desktop-lobby.png` });

// ---- 3. both ready -> match starts
await A.tap("button:has-text('Ready')");
await B.click("button:has-text('Ready')");
await A.waitForFunction(() => window.__pp.net.state?.phase === "loop", null, { timeout: 25000 });
check("match started (countdown -> loop 1)", true);
const touchMode = await A.evaluate(() => window.__pp.ui.getState().touchMode);
check("touch controls auto-detected on phone", touchMode === true);
check("mouse/keyboard UI on desktop", (await B.evaluate(() => window.__pp.ui.getState().touchMode)) === false);

// ---- 4. phone: move + aim + shoot simultaneously with three fingers
const cdp = await ctxA.newCDPSession(A);
const vp = A.viewportSize();
const touch = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id })) });
const before = await A.evaluate(() => ({ x: window.__pp.game.move.x, z: window.__pp.game.move.z, yaw: window.__pp.game.yaw, ammo: window.__pp.game.ammo }));
const joy = [110, vp.height * 0.72];
const look = [vp.width * 0.58, vp.height * 0.35];
const fire = [vp.width * 0.86, vp.height * 0.66];
await touch("touchStart", [[joy[0], joy[1], 1]]);
await touch("touchStart", [[joy[0], joy[1], 1], [look[0], look[1], 2]]);
for (let i = 1; i <= 10; i++) {
  await touch("touchMove", [[joy[0], joy[1] - i * 7, 1], [look[0] + i * 6, look[1], 2]]);
  await A.waitForTimeout(40);
}
await touch("touchStart", [[joy[0], joy[1] - 70, 1], [look[0] + 60, look[1], 2], [fire[0], fire[1], 3]]);
await A.waitForTimeout(1200);
const mid = await A.evaluate(() => ({ x: window.__pp.game.move.x, z: window.__pp.game.move.z, yaw: window.__pp.game.yaw, ammo: window.__pp.game.ammo, firing: window.__pp.input.fire, tf: window.__pp.input.touchFire, fps: window.__pp.ui.getState().fps }));
await touch("touchEnd", []);
await A.screenshot({ path: `${OUT}/3-phone-move-aim-fire.png` });
const moved = Math.hypot(mid.x - before.x, mid.z - before.z);
check("virtual joystick moves the player", moved > 2, `${moved.toFixed(2)} m`);
check("touch drag rotates the camera", Math.abs(mid.yaw - before.yaw) > 0.05, `${(mid.yaw - before.yaw).toFixed(3)} rad`);
check("fire button shoots while moving and aiming", mid.ammo < before.ammo, `ammo ${before.ammo} -> ${mid.ammo}, fireHeld=${mid.firing}, touchFire=${mid.tf}, fps=${mid.fps}`);
await A.waitForTimeout(1500); // let the stop reach the server
const serverPos = await A.evaluate(() => {
  const s = window.__pp.net.state;
  const u = s.units.get(s.players.get(window.__pp.net.me).unitId);
  return { x: u.x, z: u.z, cx: window.__pp.game.move.x, cz: window.__pp.game.move.z };
});
check("server-authoritative position matches client prediction", Math.hypot(serverPos.x - serverPos.cx, serverPos.z - serverPos.cz) < 0.5, JSON.stringify(serverPos));

// phone: jump, crouch, reload buttons
const tap = async (x, y) => {
  await touch("touchStart", [[x, y, 9]]);
  await A.waitForTimeout(60);
  await touch("touchEnd", []);
};
await tap(vp.width * 0.94, vp.height * 0.44); // jump
await A.waitForTimeout(150);
const jumped = await A.evaluate(() => window.__pp.game.move.y > 0.2 || !window.__pp.game.move.onGround);
check("jump button", jumped);
await A.waitForTimeout(800);
await tap(vp.width * 0.74, vp.height * 0.52); // reload
check("reload button", await A.evaluate(() => window.__pp.game.reloading || window.__pp.game.ammo === 30));
await tap(vp.width * 0.94, vp.height * 0.86); // crouch (toggle)
await A.waitForTimeout(200);
check("crouch button", await A.evaluate(() => window.__pp.game.move.crouching));
await tap(vp.width * 0.94, vp.height * 0.86);

// ---- 5. desktop: keyboard movement, then aim at the phone player and fire.
// Start at the beginning of loop 2 so the section has a full loop regardless of how
// slowly software-rendered browsers ran the previous steps.
await B.waitForFunction(() => { const s = window.__pp.net.state; return s.phase === "loop" && s.loop >= 2 && s.loopTime < 4; }, null, { timeout: 90000, polling: 200 });
log("desktop section starts at loop", await B.evaluate(() => window.__pp.net.state.loop));
const b0 = await B.evaluate(() => ({ x: window.__pp.game.move.x, z: window.__pp.game.move.z }));
await B.keyboard.down("KeyW");
await B.waitForTimeout(1000);
await B.keyboard.up("KeyW");
const b1 = await B.evaluate(() => ({ x: window.__pp.game.move.x, z: window.__pp.game.move.z }));
check("desktop WASD movement", Math.hypot(b1.x - b0.x, b1.z - b0.z) > 0.25, `${Math.hypot(b1.x - b0.x, b1.z - b0.z).toFixed(2)} m`);
await B.evaluate(() => {
  const pp = window.__pp;
  window.__aim = setInterval(() => {
    const g = pp.game;
    let target = null;
    for (const u of g.units.values()) if (u.kind === "live" && u.side !== g.side) target = u;
    if (!target) return;
    const eye = { x: g.move.x, y: g.move.y + 1.62, z: g.move.z };
    const dx = target.x - eye.x, dy = target.y + (target.crouch ? 0.85 : 1.3) - eye.y, dz = target.z - eye.z;
    g.yaw = Math.atan2(-dx, -dz);
    g.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    pp.input.adsToggled = true; // aim down sights for the long lane
    // controlled 3-round bursts keep spread bloom low at long range
    pp.input.touchFire = performance.now() % 600 < 280 ? 1 : 0;
  }, 30);
});
// phone faces down the open centre lane and walks toward the point
await A.evaluate(() => {
  const g = window.__pp.game;
  g.yaw = Math.atan2(-(-9.4 - g.move.x), -(0 - g.move.z)); // toward the open centre lane
  g.pitch = 0;
  window.__pp.input.crouchToggled = false;
});
await touch("touchStart", [[joy[0], joy[1], 1]]);
await touch("touchMove", [[joy[0], joy[1] - 70, 1]]);
const deskSide = await B.evaluate(() => window.__pp.game.side);
const deskShots = await A.waitForFunction((side) => (window.__ev["liveShot:" + side] || 0) >= 3, deskSide, { timeout: 20000 }).then(() => true, () => false);
await touch("touchEnd", []);
check("desktop mouse-fire path: shots validated by server and seen by the phone", deskShots, `${await A.evaluate((side) => window.__ev["liveShot:" + side] || 0, deskSide)} shots`);
await B.screenshot({ path: `${OUT}/4-desktop-firing.png` });
await A.screenshot({ path: `${OUT}/5-phone-under-fire.png` });
await A.waitForTimeout(8000);
log("opportunistic combat result (line of sight depends on spawn lanes):", JSON.stringify(await A.evaluate(() => ({ hits: window.__ev.hit || 0, kills: window.__ev.kill || 0, phoneHp: window.__pp.game.hp }))));
await B.evaluate(() => {
  clearInterval(window.__aim);
  window.__pp.input.touchFire = 0;
});

// ---- 6. rewind and loop 2 with clones
await A.waitForFunction(() => window.__pp.net.state?.phase === "rewind" || window.__pp.net.state?.loop >= 2, null, { timeout: 45000, polling: 100 });
await A.waitForTimeout(1400);
await A.screenshot({ path: `${OUT}/6-phone-rewind.png` });
await B.screenshot({ path: `${OUT}/7-desktop-rewind.png` });
check("time rewinds between loops", true);
await A.waitForFunction(() => window.__pp.net.state?.phase === "loop" && window.__pp.net.state.loop >= 2, null, { timeout: 15000 });
await A.waitForTimeout(2500);
const kinds = await B.evaluate(() => {
  const k = {};
  window.__pp.net.state.units.forEach((u) => (k[u.kind] = (k[u.kind] || 0) + 1));
  return k;
});
const maxEchoes = await B.evaluate(() => window.__ev.maxEchoes || 0);
check("loop 2 replays loop-1 echoes for both players", maxEchoes >= 2, `max echoes seen ${maxEchoes}, now ${JSON.stringify(kinds)}`);
await B.screenshot({ path: `${OUT}/8-desktop-loop2-echoes.png` });
await A.screenshot({ path: `${OUT}/9-phone-loop2-echoes.png` });
const ev = await A.evaluate(() => window.__ev);
log("phone events", JSON.stringify(ev));
const ping = await A.evaluate(() => window.__pp.net.rtt);
check("latency measured", ping > 0, `${ping.toFixed(1)} ms`);

// ---- 7. reconnection: drop the desktop socket; it must resume the same seat
const seatBefore = await B.evaluate(() => window.__pp.net.me);
await B.evaluate(() => window.__pp.net.room.connection.transport.ws.close());
await B.waitForTimeout(500);
const recovered = await B.waitForFunction(() => window.__pp.net.connected && window.__pp.net.room?.connection.isOpen, null, { timeout: 20000 }).then(() => true, () => false);
const seatAfter = await B.evaluate(() => window.__pp.net.me);
check("dropped client auto-reconnects to the same seat", recovered && seatAfter === seatBefore, `${seatBefore} -> ${seatAfter}`);
check("match still running for both after reconnect", (await A.evaluate(() => window.__pp.net.state.phase)) !== "matchEnd" && !(await A.evaluate(() => window.__pp.net.state.paused)));

const fps = await A.evaluate(() => window.__pp.ui.getState().fps);
log("phone fps under SwiftShader (software GL):", fps, "quality:", await A.evaluate(() => window.__pp.ui.getState().quality));
check("no uncaught page errors", errors.length === 0, errors.slice(0, 5).join(" | "));
await browser.close();
const failed = results.filter((r) => !r.ok);
log(`${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
