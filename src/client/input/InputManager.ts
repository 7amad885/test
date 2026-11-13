// Unified input: keyboard + mouse (pointer lock), multi-touch controls and
// gamepads all write into one state that the fixed-step simulation samples.

import { useUI } from "../store";

const LOOK_MOUSE = 0.0022;
const LOOK_TOUCH = 0.0058;
const LOOK_PAD = 3.4; // rad/s at full deflection

class InputManager {
  // keyboard
  private keys = new Set<string>();
  private mouseFire = false;
  private mouseAds = false;
  // touch
  joyX = 0;
  joyY = 0;
  touchFire = 0; // number of fire buttons held
  // gamepad
  private padMoveX = 0;
  private padMoveY = 0;
  private padFire = false;
  private padAds = false;
  private padPrev: boolean[] = [];
  padConnected = false;

  // toggles
  adsToggled = false;
  crouchToggled = false;
  sprintToggled = false;
  private adsHeldTouch = false;
  private crouchHeldTouch = false;
  private sprintHeldTouch = false;

  // accumulators consumed by the game loop
  lookDX = 0;
  lookDY = 0;
  jumpQueued = false;
  reloadQueued = false;
  /** set when any action happens; used to switch touch/desktop UI automatically */
  lastDevice: "touch" | "mouse" | "pad" = "mouse";
  pointerLocked = false;
  enabled = true;
  private autoSprintTimer = 0;

  private windowBound = false;
  private canvas: HTMLElement | null = null;

  attach(canvas: HTMLElement) {
    this.canvas = canvas;
    canvas.addEventListener("mousedown", (e) => {
      if (useUI.getState().touchMode || (e as PointerEvent).pointerType === "touch") return;
      if (!this.pointerLocked) {
        if (useUI.getState().settingsOpen) return;
        const req = canvas.requestPointerLock?.() as unknown as Promise<void> | undefined;
        req?.catch?.(() => {});
        return;
      }
      if (e.button === 0) this.mouseFire = true;
      if (e.button === 2) this.mouseAds = true;
    });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    if (this.windowBound) return;
    this.windowBound = true;
    const onKey = (e: KeyboardEvent, down: boolean) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      const k = e.code;
      if (down) {
        if (k === "Space") this.jumpQueued = true;
        if (k === "KeyR") this.reloadQueued = true;
        if (k === "KeyC" && !e.repeat) this.crouchToggled = !this.crouchToggled;
        if (k === "Escape" || k === "KeyP") {
          if (!this.pointerLocked) useUI.getState().set({ settingsOpen: !useUI.getState().settingsOpen });
        }
        this.keys.add(k);
      } else this.keys.delete(k);
      if (["Space", "ArrowUp", "ArrowDown", "Tab"].includes(k)) e.preventDefault();
      this.lastDevice = "mouse";
    };
    window.addEventListener("keydown", (e) => onKey(e, true));
    window.addEventListener("keyup", (e) => onKey(e, false));
    window.addEventListener("blur", () => {
      this.keys.clear();
      this.mouseFire = false;
      this.mouseAds = false;
    });

    window.addEventListener("mouseup", (e) => {
      if (e.button === 0) this.mouseFire = false;
      if (e.button === 2) this.mouseAds = false;
    });
    document.addEventListener("pointerlockchange", () => {
      this.pointerLocked = !!document.pointerLockElement && document.pointerLockElement === this.canvas;
      if (!this.pointerLocked) {
        this.mouseFire = false;
        this.mouseAds = false;
      }
    });
    window.addEventListener("mousemove", (e) => {
      if (!this.pointerLocked || !this.enabled) return;
      const s = useUI.getState().settings;
      const m = LOOK_MOUSE * s.lookSens * this.adsMult();
      this.lookDX += e.movementX * m;
      this.lookDY += e.movementY * m * (s.invertY ? -1 : 1);
      this.lastDevice = "mouse";
    });
    window.addEventListener("gamepadconnected", () => (this.padConnected = true));
    window.addEventListener("gamepaddisconnected", () => (this.padConnected = false));
  }

  private adsMult() {
    return this.ads ? useUI.getState().settings.adsSens : 1;
  }

  /** Touch look drag in CSS pixels. */
  touchLook(dx: number, dy: number) {
    if (!this.enabled) return;
    const s = useUI.getState().settings;
    const m = LOOK_TOUCH * s.lookSens * this.adsMult();
    this.lookDX += dx * m;
    this.lookDY += dy * m * (s.invertY ? -1 : 1);
    this.lastDevice = "touch";
  }

  pressAds(down: boolean) {
    const mode = useUI.getState().settings.adsMode;
    if (mode === "toggle") {
      if (down) this.adsToggled = !this.adsToggled;
    } else this.adsHeldTouch = down;
    if (down) this.sprintToggled = false;
  }

  pressCrouch(down: boolean) {
    const mode = useUI.getState().settings.crouchMode;
    if (mode === "toggle") {
      if (down) this.crouchToggled = !this.crouchToggled;
    } else this.crouchHeldTouch = down;
  }

  pressSprint(down: boolean) {
    const mode = useUI.getState().settings.sprintMode;
    if (mode === "toggle") {
      if (down) this.sprintToggled = !this.sprintToggled;
    } else this.sprintHeldTouch = down;
    if (down) {
      this.adsToggled = false;
      this.crouchToggled = false;
    }
  }

  get ads(): boolean {
    return this.adsToggled || this.adsHeldTouch || this.mouseAds || this.padAds;
  }

  get crouch(): boolean {
    return this.crouchToggled || this.crouchHeldTouch || this.keys.has("ControlLeft");
  }

  get fire(): boolean {
    return this.enabled && (this.mouseFire || this.touchFire > 0 || this.padFire);
  }

  /** Movement vector: x = strafe right, z = forward. */
  move(): { x: number; z: number } {
    let x = 0,
      z = 0;
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) z += 1;
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) z -= 1;
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) x += 1;
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) x -= 1;
    x += this.joyX + this.padMoveX;
    z += this.joyY + this.padMoveY;
    const l = Math.hypot(x, z);
    if (l > 1) {
      x /= l;
      z /= l;
    }
    if (!this.enabled) return { x: 0, z: 0 };
    return { x, z };
  }

  sprint(dt: number): boolean {
    const mv = this.move();
    if (mv.z < 0.3) this.sprintToggled = false;
    const s = useUI.getState().settings;
    // Auto-sprint: joystick pushed to the rim, forward, for a moment.
    if (s.autoSprint && this.joyY > 0.92 && Math.abs(this.joyX) < 0.4) {
      this.autoSprintTimer += dt;
      if (this.autoSprintTimer > 0.35) return true;
    } else this.autoSprintTimer = 0;
    return this.sprintToggled || this.sprintHeldTouch || this.keys.has("ShiftLeft") || this.keys.has("ShiftRight");
  }

  /** Poll gamepads once per frame. */
  pollGamepad(dt: number) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let pad: Gamepad | null = null;
    for (const p of pads) if (p && p.connected) pad = p;
    if (!pad) {
      this.padMoveX = this.padMoveY = 0;
      this.padFire = this.padAds = false;
      return;
    }
    const dz = (v: number, d = 0.16) => (Math.abs(v) < d ? 0 : (v - Math.sign(v) * d) / (1 - d));
    const curve = (v: number) => Math.sign(v) * Math.pow(Math.abs(v), 1.6);
    this.padMoveX = dz(pad.axes[0] ?? 0);
    this.padMoveY = -dz(pad.axes[1] ?? 0);
    const lx = curve(dz(pad.axes[2] ?? 0, 0.12));
    const ly = curve(dz(pad.axes[3] ?? 0, 0.12));
    const s = useUI.getState().settings;
    const k = LOOK_PAD * s.gamepadSens * this.adsMult() * dt;
    if (this.enabled) {
      this.lookDX += lx * k;
      this.lookDY += ly * k * 0.75 * (s.invertY ? -1 : 1);
    }
    const b = (i: number) => {
      const btn = pad!.buttons[i];
      return !!btn && (btn.pressed || btn.value > 0.4);
    };
    const edge = (i: number) => b(i) && !this.padPrev[i];
    this.padFire = b(7);
    this.padAds = b(6);
    if (edge(0)) this.jumpQueued = true;
    if (edge(1)) this.crouchToggled = !this.crouchToggled;
    if (edge(2)) this.reloadQueued = true;
    if (edge(10) || edge(4)) this.sprintToggled = !this.sprintToggled;
    if (edge(9)) useUI.getState().set({ settingsOpen: !useUI.getState().settingsOpen });
    if (pad.buttons.some((x) => x.pressed) || Math.abs(lx) + Math.abs(ly) + Math.abs(this.padMoveX) > 0) this.lastDevice = "pad";
    this.padPrev = pad.buttons.map((x) => x.pressed || x.value > 0.4);
  }

  consumeLook(): [number, number] {
    const r: [number, number] = [this.lookDX, this.lookDY];
    this.lookDX = this.lookDY = 0;
    return r;
  }

  resetActions() {
    this.adsToggled = this.crouchToggled = this.sprintToggled = false;
    this.adsHeldTouch = this.crouchHeldTouch = this.sprintHeldTouch = false;
    this.touchFire = 0;
    this.joyX = this.joyY = 0;
    this.mouseFire = this.mouseAds = false;
  }
}

export const input = new InputManager();
