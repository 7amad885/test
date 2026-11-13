import { describe, expect, it } from "vitest";
import {
  COUNTDOWN_DURATION,
  LOOP_DURATION,
  REWIND_DURATION,
  ROUND_END_DURATION,
  TICK_DT,
} from "../src/shared/constants";
import { eyeOf } from "../src/shared/physics";
import type { ParadoxEvent, ServerEvent } from "../src/shared/protocol";
import { MatchSim, type SimUnit } from "../src/server/sim";

function ticks(sim: MatchSim, seconds: number, log?: ServerEvent[]) {
  const n = Math.round(seconds / TICK_DT);
  for (let i = 0; i < n; i++) {
    sim.update(TICK_DT);
    const ev = sim.drainEvents();
    if (log) log.push(...ev);
  }
}

function startedSim() {
  const sim = new MatchSim(() => 0.5);
  sim.addPlayer("a", "Alice");
  sim.addPlayer("b", "Bob");
  sim.setReady("a", true);
  sim.setReady("b", true);
  expect(sim.phase).toBe("countdown");
  ticks(sim, COUNTDOWN_DURATION + TICK_DT);
  expect(sim.phase).toBe("loop");
  return sim;
}

function untilLoop(sim: MatchSim, loop: number, log?: ServerEvent[]) {
  for (let i = 0; i < 10000 && !(sim.phase === "loop" && sim.loop === loop); i++) {
    sim.update(TICK_DT);
    const ev = sim.drainEvents();
    if (log) log.push(...ev);
  }
  expect(sim.loop).toBe(loop);
  expect(sim.phase).toBe("loop");
}

const live = (sim: MatchSim, pid: string) => sim.units.get(sim.players.get(pid)!.unitId!)!;

function place(u: SimUnit, x: number, z: number) {
  u.move.x = x;
  u.move.z = z;
  u.move.y = 0;
}

/** Fire from player `pid` at a unit's chest, one shot per call. */
function shootAt(sim: MatchSim, pid: string, target: SimUnit) {
  const u = live(sim, pid);
  const o = { x: u.move.x, y: u.move.y + eyeOf(u.move.crouching), z: u.move.z };
  const dx = target.move.x - o.x,
    dy = target.move.y + 1.1 - o.y,
    dz = target.move.z - o.z;
  const len = Math.hypot(dx, dy, dz);
  const yaw = Math.atan2(-dx, -dz);
  const pitch = Math.asin(dy / len);
  return sim.fire(pid, { dx: dx / len, dy: dy / len, dz: dz / len, yaw, pitch, rewind: 0, id: 1 });
}

function killWithShots(sim: MatchSim, pid: string, target: SimUnit, log: ServerEvent[]) {
  for (let i = 0; i < 8 && target.kind !== "ghost" && sim.units.has(target.id) && target.hp > 0; i++) {
    expect(shootAt(sim, pid, target)).toBe(true);
    log.push(...sim.drainEvents());
    ticks(sim, 0.1, log);
  }
}

const paradoxes = (log: ServerEvent[]) =>
  log.filter((e): e is { type: "paradox"; data: ParadoxEvent } => e.type === "paradox").map((e) => e.data);

describe("match flow", () => {
  it("assigns opposite sides and starts only when both are ready", () => {
    const sim = new MatchSim();
    expect(sim.addPlayer("a", "A")!.side).toBe(0);
    expect(sim.addPlayer("b", "B")!.side).toBe(1);
    expect(sim.addPlayer("c", "C")).toBeNull();
    sim.setReady("a", true);
    expect(sim.phase).toBe("lobby");
    sim.setReady("b", true);
    expect(sim.phase).toBe("countdown");
    expect(sim.units.size).toBe(2);
  });

  it("runs three loops with rewinds and replays history as clones", () => {
    const sim = startedSim();
    ticks(sim, LOOP_DURATION);
    expect(sim.phase).toBe("rewind");
    expect(sim.units.size).toBe(0);
    ticks(sim, REWIND_DURATION + TICK_DT);
    expect(sim.phase).toBe("loop");
    expect(sim.loop).toBe(2);
    const kinds = [...sim.units.values()].map((u) => u.kind).sort();
    expect(kinds).toEqual(["clone", "clone", "live", "live"]);
    ticks(sim, LOOP_DURATION + REWIND_DURATION + TICK_DT);
    expect(sim.loop).toBe(3);
    expect([...sim.units.values()].filter((u) => u.kind === "clone")).toHaveLength(4);
  });

  it("rejects speed hacks through the input time budget", () => {
    const sim = startedSim();
    const u = live(sim, "a");
    const x0 = u.move.x;
    // 200 inputs of 50ms in a single tick would be 10 s of movement.
    for (let i = 1; i <= 200; i++)
      sim.input("a", { seq: i, dt: 0.05, mx: 0, mz: 1, yaw: -Math.PI / 2, pitch: 0, jump: false, sprint: true, crouch: false, ads: false });
    expect(u.move.x - x0).toBeLessThan(2.5);
  });

  it("validates rate of fire and ammo", () => {
    const sim = startedSim();
    ticks(sim, 1.5);
    const b = live(sim, "b");
    place(b, 0, -10);
    place(live(sim, "a"), 0, 10);
    expect(shootAt(sim, "a", b)).toBe(true);
    expect(shootAt(sim, "a", b)).toBe(true); // jitter burst tolerated
    expect(shootAt(sim, "a", b)).toBe(false); // but sustained rate is capped
    expect(sim.players.get("a")!.ammo).toBe(28);
    // a full minute of attempts at 1000 rpm yields only the rifle's rpm
    let ok = 0;
    for (let i = 0; i < 300; i++) {
      if (shootAt(sim, "a", b)) ok++;
      sim.drainEvents();
      sim.update(0.06);
      if (!sim.players.get("a")!.reloadEnd) continue;
      sim.players.get("a")!.ammo = 30;
      sim.players.get("a")!.reloadEnd = 0;
      if (b.hp <= 0 || !sim.units.has(b.id)) break;
    }
    expect(ok).toBeLessThanOrEqual(Math.ceil((300 * 0.06) / (60 / 620)) + 2);
  });
});

describe("time-loop causality", () => {
  it("replays a recorded kill (fulfilled), then a timeline change rescues the victim into an anomaly", () => {
    const sim = startedSim();
    const log: ServerEvent[] = [];
    ticks(sim, 1.5, log); // past spawn protection
    const a1 = live(sim, "a");
    const b1 = live(sim, "b");
    place(a1, 0, 10);
    place(b1, 0, -10);
    ticks(sim, 0.2, log);
    const deathId = a1.id;
    killWithShots(sim, "b", a1, log);
    expect(sim.units.has(deathId)).toBe(false);
    const trA = sim.tracks.find((t) => t.id === deathId)!;
    expect(trA.endReason).toBe("death");
    // Alice respawns within the same loop as a new track.
    ticks(sim, 4.5, log);
    expect(sim.players.get("a")!.unitId).not.toBe(deathId);

    // ---- Loop 2: no one interferes, history repeats exactly.
    untilLoop(sim, 2, log);
    log.length = 0;
    ticks(sim, trA.endT + 1, log);
    const p2 = paradoxes(log);
    expect(p2.find((p) => p.unit === deathId)?.type).toBe("fulfilled");
    expect(sim.units.get(deathId)?.kind).toBe("ghost");

    // ---- Loop 3: Alice kills Bob's loop-1 clone before it can fire.
    untilLoop(sim, 3, log);
    log.length = 0;
    ticks(sim, 1.57, log); // Bob's echo has walked to its loop-1 firing position (placed at t=1.5)
    const bobEcho = sim.units.get(b1.id)!;
    expect(bobEcho.kind).toBe("clone");
    const a3 = live(sim, "a");
    place(a3, 0, -16); // behind Bob's echo, out of its line of fire
    killWithShots(sim, "a", bobEcho, log);
    expect(bobEcho.kind).toBe("ghost");
    expect(paradoxes(log).find((p) => p.unit === b1.id)?.type).toBe("erased");

    ticks(sim, trA.endT + 0.5 - sim.loopTime, log);
    const aliceEcho = sim.units.get(deathId)!;
    expect(aliceEcho.kind).toBe("anomaly");
    expect(paradoxes(log).find((p) => p.unit === deathId)?.type).toBe("rescued");
    expect(sim.players.get("a")!.rescued).toBe(1);
    expect(sim.players.get("a")!.erased).toBeGreaterThanOrEqual(1);
  });

  it("lets a live player body-block a historical shot meant for someone else", () => {
    const sim = startedSim();
    const log: ServerEvent[] = [];
    ticks(sim, 1.5, log);
    const a1 = live(sim, "a");
    const b1 = live(sim, "b");
    place(a1, 0, 10);
    place(b1, 0, -10);
    ticks(sim, 0.2, log);
    expect(shootAt(sim, "b", a1)).toBe(true); // recorded: Bob hits Alice at z=10
    const shotT = sim.loopTime;
    untilLoop(sim, 2, log);
    // Alice (live) stands between Bob's echo and her own echo when the shot replays.
    ticks(sim, shotT - sim.loopTime - 0.2, log);
    const a2 = live(sim, "a");
    place(a2, 0, 2);
    a2.protUntil = 0;
    log.length = 0;
    ticks(sim, 0.4, log);
    const hits = log.filter((e) => e.type === "hit").map((e) => (e as { data: { target: string } }).data.target);
    expect(hits).toContain(a2.id);
    expect(hits).not.toContain(a1.id);
  });
});

describe("capture point and scoring", () => {
  it("moves the meter only while uncontested and awards the round at the end of loop 3", () => {
    const sim = startedSim();
    const a = live(sim, "a");
    const b = live(sim, "b");
    place(a, 0, 0);
    ticks(sim, 2);
    expect(sim.meter).toBeGreaterThan(0);
    const m = sim.meter;
    place(b, 1, 1);
    ticks(sim, 2);
    expect(sim.capture).toBe(2);
    expect(sim.meter).toBeCloseTo(m, 5);
  });

  it("instantly wins the round at full meter and the match at three rounds", () => {
    const sim = startedSim();
    for (let r = 1; r <= 3; r++) {
      if (r > 1) ticks(sim, ROUND_END_DURATION + COUNTDOWN_DURATION + TICK_DT * 2);
      expect(sim.phase).toBe("loop");
      expect(sim.round).toBe(r);
      sim.meter = 99.99;
      place(live(sim, "a"), 0, 0);
      ticks(sim, 0.1);
      expect(sim.roundWins[0]).toBe(r);
    }
    expect(sim.phase).toBe("matchEnd");
    expect(sim.matchWinner).toBe(0);
    // rematch
    sim.setReady("a", true);
    sim.setReady("b", true);
    expect(sim.phase).toBe("countdown");
    expect(sim.roundWins).toEqual([0, 0]);
  });

  it("decides the round by meter sign after the third loop", () => {
    const sim = startedSim();
    place(live(sim, "b"), 0, 0);
    ticks(sim, 1);
    ticks(sim, (LOOP_DURATION + REWIND_DURATION) * 3);
    expect(["roundEnd", "countdown", "loop"]).toContain(sim.phase);
    expect(sim.roundWins[1]).toBe(1);
  });

  it("pauses while a player is disconnected and forfeits on timeout", () => {
    const sim = startedSim();
    const t = sim.loopTime;
    sim.setConnected("b", false);
    ticks(sim, 2);
    expect(sim.loopTime).toBe(t);
    sim.forfeit("b");
    expect(sim.phase).toBe("matchEnd");
    expect(sim.matchWinner).toBe(0);
  });
});
