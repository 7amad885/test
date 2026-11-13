// Deterministic network test with raw Colyseus clients (no rendering):
// private room by code, full-room rejection, ready-up, server-validated combat
// to a kill, disconnect freeze and same-seat reconnection.
//   BASE_URL=http://localhost:2567 node tests/e2e/protocol.mjs
import { Client } from "colyseus.js";
const BASE = process.env.BASE_URL || "http://localhost:2567";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(ok ? "PASS" : "FAIL", name, detail);
};
const c = new Client(BASE);
const a = await c.create("duel", { name: "Host", device: "iPhone" });
check("private room created with 5-char code", /^[A-Z0-9]{5}$/.test(a.roomId), a.roomId);
const lookup = await fetch(`${BASE}/api/room/${a.roomId}`).then((r) => r.json());
check("room lookup endpoint finds it", lookup.exists === true, JSON.stringify(lookup));
const b = await c.joinById(a.roomId, { name: "Guest", device: "PC" });
const ev = [];
for (const r of [a, b]) r.onMessage("*", (t, m) => t === "ev" && r === a && ev.push(...m));
const third = await c.joinById(a.roomId, { name: "Third" }).then(() => "joined", (e) => e.message);
check("third player is rejected (1v1 only)", third !== "joined", third);
await wait(300);
a.send("ready", { ready: true });
b.send("ready", { ready: true });
await wait(4300);
check("both ready -> loop 1 running", a.state.phase === "loop" && a.state.loop === 1);

// spawn protection passes, then the host fires down the open centre lane at the guest
await wait(1300);
const me = a.state.units.get(a.state.players.get(a.sessionId).unitId);
const foe = a.state.units.get(a.state.players.get(b.sessionId).unitId);
const o = { x: me.x, y: me.y + 1.62, z: me.z };
let kills = 0;
for (let i = 0; i < 10 && !kills; i++) {
  const f = a.state.units.get(foe.id) || foe;
  const dx = f.x - o.x, dy = f.y + 1.1 - o.y, dz = f.z - o.z;
  const len = Math.hypot(dx, dy, dz);
  a.send("fire", { dx: dx / len, dy: dy / len, dz: dz / len, yaw: Math.atan2(-dx, -dz), pitch: Math.asin(dy / len), rewind: 0, id: i + 1 });
  await wait(130);
  kills = ev.filter((e) => e.type === "kill").length;
}
const hits = ev.filter((e) => e.type === "hit" && e.data.dmg > 0);
check("server validates hits over the network", hits.length >= 4, `${hits.length} hits, ${ev.filter((e) => e.type === "shot").length} shots`);
check("lethal damage produces a kill and a respawn timer", kills === 1 && a.state.players.get(b.sessionId).respawnIn > 0);
// cheating: a shot pointing 90° away from the reported view is rejected
const ammoBefore = a.state.players.get(a.sessionId).ammo;
a.send("fire", { dx: 1, dy: 0, dz: 0, yaw: 0, pitch: 0, rewind: 0, id: 99 });
await wait(300);
check("shot outside the spread cone is rejected", a.state.players.get(a.sessionId).ammo === ammoBefore);

// disconnect: time freezes, reconnect resumes the same seat
const t0 = a.state.loopTime;
const token = b.reconnectionToken;
b.connection.transport.ws.close();
await wait(1500);
check("match freezes while a player is disconnected", a.state.paused && Math.abs(a.state.loopTime - t0) < 1.2, `pauseLeft ${a.state.pauseLeft.toFixed(1)}s`);
const b2 = await c.reconnect(token);
b2.onMessage("*", () => {});
await wait(600);
check("reconnect resumes the same seat and unfreezes", !a.state.paused && b2.sessionId === b.sessionId);
a.leave();
b2.leave();
const failed = results.filter((x) => !x).length;
console.log(`${results.length - failed}/${results.length} protocol checks passed`);
process.exit(failed ? 1 : 0);
