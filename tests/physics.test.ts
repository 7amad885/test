import { describe, expect, it } from "vitest";
import { TICK_DT, WALK_SPEED } from "../src/shared/constants";
import { dirFromAngles, newMoveState, raycastWorld, rayCharacter, stepMove, type MoveInput } from "../src/shared/physics";

const idle: MoveInput = { mx: 0, mz: 0, yaw: 0, jump: false, sprint: false, crouch: false, ads: false };

describe("movement", () => {
  it("walks forward along -z at yaw 0 and reaches walk speed", () => {
    const s = newMoveState(0, 0, -12);
    for (let i = 0; i < 30; i++) stepMove(s, { ...idle, mz: 1 }, TICK_DT);
    expect(s.z).toBeLessThan(-14);
    expect(Math.abs(s.x)).toBeLessThan(1e-6);
    expect(Math.hypot(s.vx, s.vz)).toBeCloseTo(WALK_SPEED, 3);
  });

  it("is stopped by the perimeter wall", () => {
    const s = newMoveState(0, 0, -20);
    for (let i = 0; i < 120; i++) stepMove(s, { ...idle, mz: 1 }, TICK_DT);
    expect(s.z).toBeGreaterThanOrEqual(-22 + 0.33);
  });

  it("climbs the stairs onto the elevated deck", () => {
    // stairs run from x=-7 (low) to x=-12 (high) at z 16.5..20.5; deck top is 2.6
    const s = newMoveState(-5, 0, 18.5);
    const yaw = Math.PI / 2; // facing -x
    for (let i = 0; i < 90; i++) stepMove(s, { ...idle, mz: 1, yaw }, TICK_DT);
    expect(s.y).toBeCloseTo(2.6, 3);
    expect(s.x).toBeLessThan(-12);
  });

  it("steps up onto the capture platform and can jump", () => {
    const s = newMoveState(0, 0, 8);
    for (let i = 0; i < 40; i++) stepMove(s, { ...idle, mz: 1 }, TICK_DT);
    expect(s.y).toBeCloseTo(0.45, 3);
    stepMove(s, { ...idle, jump: true }, TICK_DT);
    expect(s.vy).toBeGreaterThan(0);
    let peak = s.y;
    for (let i = 0; i < 40; i++) {
      stepMove(s, idle, TICK_DT);
      peak = Math.max(peak, s.y);
    }
    expect(peak).toBeGreaterThan(1.3);
    expect(s.y).toBeCloseTo(0.45, 3);
    expect(s.onGround).toBe(true);
  });

  it("cannot stand up under nothing-blocked conditions only", () => {
    const s = newMoveState(0, 0, 12);
    stepMove(s, { ...idle, crouch: true }, TICK_DT);
    expect(s.crouching).toBe(true);
    stepMove(s, idle, TICK_DT);
    expect(s.crouching).toBe(false);
  });
});

describe("raycasts", () => {
  it("hits the floor and walls", () => {
    const down = raycastWorld({ x: 0, y: 5, z: 12 }, { x: 0, y: -1, z: 0 }, 100);
    expect(down.t).toBeCloseTo(5, 5);
    expect(down.ny).toBe(1);
    const wall = raycastWorld({ x: 0, y: 1.6, z: 12 }, { x: 0, y: 0, z: 1 }, 100);
    expect(wall.t).toBeCloseTo(22 - 12, 5);
    expect(wall.nz).toBe(-1);
  });

  it("distinguishes head and body hits", () => {
    const pose = { x: 0, y: 0, z: -10, crouch: false };
    const head = rayCharacter({ x: 0, y: 1.62, z: 0 }, dirFromAngles(0, 0), pose, 100);
    expect(head?.head).toBe(true);
    const body = rayCharacter({ x: 0, y: 1.0, z: 0 }, dirFromAngles(0, 0), pose, 100);
    expect(body?.head).toBe(false);
    expect(body?.t).toBeCloseTo(9.7, 5);
    const miss = rayCharacter({ x: 2, y: 1.0, z: 0 }, dirFromAngles(0, 0), pose, 100);
    expect(miss).toBeNull();
  });
});
