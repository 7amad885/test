import { useEffect, useRef, useState, type ReactNode } from "react";
import { audio } from "../audio";
import { input } from "../input/InputManager";
import { game } from "../game/runtime";
import { useUI, type ControlId } from "../store";

const BASE: Record<ControlId, number> = { joystick: 150, fire: 92, fireL: 70, ads: 62, jump: 62, crouch: 58, reload: 54, sprint: 56 };

const Icon = {
  fire: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="7" />
      <path d="M12 2v5M12 17v5M2 12h5M17 12h5" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
    </svg>
  ),
  ads: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z" />
      <circle cx="12" cy="12" r="2.5" />
    </svg>
  ),
  jump: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  ),
  crouch: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
      <path d="M12 5v14M5 12l7 7 7-7" />
    </svg>
  ),
  reload: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
      <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />
    </svg>
  ),
  sprint: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
      <path d="M5 17l5-5-5-5M13 17l5-5-5-5" />
    </svg>
  ),
};

export function TouchControls() {
  const settings = useUI((s) => s.settings);
  const editor = useUI((s) => s.layoutEditor);
  const [selected, setSelected] = useState<ControlId>("fire");
  const [, tick] = useState(0);
  const joy = useRef<{ id: number | null; ox: number; oy: number; x: number; y: number }>({ id: null, ox: 0, oy: 0, x: 0, y: 0 });
  const looks = useRef(new Map<number, { x: number; y: number }>());
  const knob = useRef<HTMLDivElement>(null);
  const base = useRef<HTMLDivElement>(null);

  // re-render at a modest rate so toggle states / reload state show
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 150);
    return () => {
      clearInterval(t);
      input.joyX = input.joyY = 0;
      input.touchFire = 0;
    };
  }, []);

  const L = settings.layout;
  const op = settings.touchOpacity;
  const size = (id: ControlId) => BASE[id] * L[id].s * settings.buttonScale;
  const W = window.innerWidth,
    H = window.innerHeight;

  // ---------------------------------------------------------------- joystick
  const joyRadius = size("joystick") / 2;
  const joyStart = (e: React.PointerEvent) => {
    if (editor) return;
    e.preventDefault();
    audio.unlock();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const j = joy.current;
    j.id = e.pointerId;
    if (settings.floatingJoystick) {
      j.ox = e.clientX;
      j.oy = e.clientY;
    } else {
      j.ox = L.joystick.x * W;
      j.oy = L.joystick.y * H;
    }
    joyMove(e);
  };
  const joyMove = (e: React.PointerEvent) => {
    const j = joy.current;
    if (j.id !== e.pointerId) return;
    let dx = e.clientX - j.ox,
      dy = e.clientY - j.oy;
    const len = Math.hypot(dx, dy);
    const max = joyRadius;
    if (len > max) {
      // drag the floating base along so the stick never "sticks" at the rim
      if (settings.floatingJoystick && len > max * 1.6) {
        j.ox += (dx / len) * (len - max);
        j.oy += (dy / len) * (len - max);
        dx = e.clientX - j.ox;
        dy = e.clientY - j.oy;
      }
      const l2 = Math.hypot(dx, dy);
      dx = (dx / l2) * max;
      dy = (dy / l2) * max;
    }
    let nx = dx / max,
      ny = -dy / max;
    const m = Math.hypot(nx, ny);
    const dead = 0.12;
    if (m < dead) nx = ny = 0;
    else {
      const k = Math.min(1, (((m - dead) / (1 - dead)) * settings.joySens) ** 1.1) / m;
      nx *= k;
      ny *= k;
    }
    input.joyX = nx;
    input.joyY = ny;
    input.lastDevice = "touch";
    if (knob.current && base.current) {
      base.current.style.left = `${j.ox}px`;
      base.current.style.top = `${j.oy}px`;
      base.current.style.opacity = "1";
      knob.current.style.transform = `translate(${dx}px, ${dy}px)`;
    }
  };
  const joyEnd = (e: React.PointerEvent) => {
    const j = joy.current;
    if (j.id !== e.pointerId) return;
    j.id = null;
    input.joyX = input.joyY = 0;
    if (knob.current && base.current) {
      knob.current.style.transform = "translate(0,0)";
      base.current.style.left = `${L.joystick.x * W}px`;
      base.current.style.top = `${L.joystick.y * H}px`;
      base.current.style.opacity = settings.floatingJoystick ? "0.55" : "1";
    }
  };

  // ---------------------------------------------------------------- look
  const lookStart = (e: React.PointerEvent) => {
    if (editor) return;
    e.preventDefault();
    audio.unlock();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    looks.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };
  const lookMove = (e: React.PointerEvent) => {
    const p = looks.current.get(e.pointerId);
    if (!p) return;
    input.touchLook(e.clientX - p.x, e.clientY - p.y);
    p.x = e.clientX;
    p.y = e.clientY;
  };
  const lookEnd = (e: React.PointerEvent) => {
    looks.current.delete(e.pointerId);
  };

  // ---------------------------------------------------------------- buttons
  const drag = useRef<{ id: ControlId; pid: number } | null>(null);
  const button = (id: ControlId, cls: string, label: ReactNode, onDown: () => void, onUp?: () => void, active = false, aim = false) => {
    if (!L[id].visible && !editor) return null;
    const s = size(id);
    return (
      <div
        key={id}
        className={`tbtn ${cls} ${active ? "on" : ""} ${editor ? "editing" : ""} ${editor && selected === id ? "selected" : ""}`}
        style={{ left: L[id].x * W, top: L[id].y * H, width: s, height: s, opacity: L[id].visible ? op : 0.3 }}
        onPointerDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          if (editor) {
            setSelected(id);
            drag.current = { id, pid: e.pointerId };
            return;
          }
          audio.unlock();
          if (aim) looks.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          onDown();
        }}
        onPointerMove={(e) => {
          if (editor && drag.current?.pid === e.pointerId) {
            useUI.getState().setLayout(id, { x: Math.min(0.98, Math.max(0.02, e.clientX / W)), y: Math.min(0.98, Math.max(0.08, e.clientY / H)) });
            return;
          }
          if (aim) lookMove(e);
        }}
        onPointerUp={(e) => {
          if (editor) {
            drag.current = null;
            return;
          }
          if (aim) lookEnd(e);
          onUp?.();
        }}
        onPointerCancel={(e) => {
          if (editor) {
            drag.current = null;
            return;
          }
          if (aim) lookEnd(e);
          onUp?.();
        }}
      >
        {label}
      </div>
    );
  };

  const fireDown = () => {
    input.touchFire++;
  };
  const fireUp = () => {
    input.touchFire = Math.max(0, input.touchFire - 1);
  };

  return (
    <div className="touch game-root" style={{ pointerEvents: "auto" }}>
      {/* move zone (left) */}
      <div className="zone" style={{ left: 0, top: "18%", width: "42%", bottom: 0 }} onPointerDown={joyStart} onPointerMove={joyMove} onPointerUp={joyEnd} onPointerCancel={joyEnd} />
      {/* look zone (right) */}
      <div className="zone" style={{ left: "42%", top: "12%", right: 0, bottom: 0 }} onPointerDown={lookStart} onPointerMove={lookMove} onPointerUp={lookEnd} onPointerCancel={lookEnd} />

      <div
        ref={base}
        className="joy-base"
        style={{ left: L.joystick.x * W, top: L.joystick.y * H, width: size("joystick"), height: size("joystick"), opacity: settings.floatingJoystick ? 0.55 * op : op }}
      >
        <div className="joy-knob" ref={knob} />
      </div>
      {editor && (
        <div
          className="tbtn editing selected"
          style={{ left: L.joystick.x * W, top: L.joystick.y * H, width: size("joystick"), height: size("joystick"), opacity: 0.8 }}
          onPointerDown={(e) => {
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            setSelected("joystick");
            drag.current = { id: "joystick", pid: e.pointerId };
          }}
          onPointerMove={(e) => {
            if (drag.current?.pid === e.pointerId)
              useUI.getState().setLayout("joystick", { x: Math.min(0.5, Math.max(0.05, e.clientX / W)), y: Math.min(0.95, Math.max(0.2, e.clientY / H)) });
          }}
          onPointerUp={() => (drag.current = null)}
        >
          JOYSTICK
        </div>
      )}

      {button("fire", "fire", Icon.fire, fireDown, fireUp, input.touchFire > 0, true)}
      {button("fireL", "fire", Icon.fire, fireDown, fireUp, false, false)}
      {button("ads", "", Icon.ads, () => input.pressAds(true), () => input.pressAds(false), input.ads)}
      {button("jump", "", Icon.jump, () => (input.jumpQueued = true))}
      {button("crouch", "", Icon.crouch, () => input.pressCrouch(true), () => input.pressCrouch(false), input.crouch)}
      {button("reload", "", game.reloading ? "…" : Icon.reload, () => (input.reloadQueued = true), undefined, game.reloading)}
      {button("sprint", "", Icon.sprint, () => input.pressSprint(true), () => input.pressSprint(false), game.sprinting)}

      {editor && <LayoutEditorBar selected={selected} />}
    </div>
  );
}

function LayoutEditorBar({ selected }: { selected: ControlId }) {
  const settings = useUI((s) => s.settings);
  const set = useUI((s) => s.setLayout);
  const l = settings.layout[selected];
  return (
    <div className="editor-bar">
      <b style={{ fontSize: 13 }}>Edit: {selected}</b>
      <label>
        Size
        <input type="range" min={0.6} max={1.8} step={0.05} value={l.s} onChange={(e) => set(selected, { s: Number(e.target.value) })} />
      </label>
      {selected !== "joystick" && selected !== "fire" && (
        <label>
          <input type="checkbox" checked={l.visible} onChange={(e) => set(selected, { visible: e.target.checked })} /> Visible
        </label>
      )}
      <label>
        Opacity
        <input type="range" min={0.2} max={1} step={0.05} value={settings.touchOpacity} onChange={(e) => useUI.getState().updateSettings({ touchOpacity: Number(e.target.value) })} />
      </label>
      <button className="btn" style={{ minHeight: 36, padding: "6px 12px" }} onClick={() => useUI.getState().resetLayout()}>
        Reset
      </button>
      <button className="btn primary" style={{ minHeight: 36, padding: "6px 14px" }} onClick={() => useUI.getState().set({ layoutEditor: false })}>
        Done
      </button>
    </div>
  );
}
