import { useState } from "react";
import { audio } from "../audio";
import { net } from "../net/NetClient";
import { useUI, type Settings as S } from "../store";

function Range({ label, value, min, max, step, onChange, fmt }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; fmt?: (v: number) => string }) {
  return (
    <div className="setting">
      <span>
        {label} <span className="muted">{fmt ? fmt(value) : value.toFixed(2)}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

function Seg<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { v: T; l: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="setting">
      <span>{label}</span>
      <div className="seg">
        {options.map((o) => (
          <button key={o.v} className={value === o.v ? "on" : ""} onClick={() => onChange(o.v)}>
            {o.l}
          </button>
        ))}
      </div>
    </div>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return <Seg label={label} value={value ? "on" : "off"} options={[{ v: "off", l: "Off" }, { v: "on", l: "On" }]} onChange={(v) => onChange(v === "on")} />;
}

export function Settings({ inGame }: { inGame: boolean }) {
  const s = useUI((x) => x.settings);
  const quality = useUI((x) => x.quality);
  const fps = useUI((x) => x.fps);
  const up = (p: Partial<S>) => useUI.getState().updateSettings(p);
  const [tab, setTab] = useState<"graphics" | "controls" | "touch" | "audio">(useUI.getState().touchMode ? "touch" : "graphics");
  const close = () => {
    audio.ui();
    useUI.getState().set({ settingsOpen: false });
  };

  return (
    <div className="overlay" style={{ zIndex: 70 }} onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="panel settings">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <h2 style={{ margin: 0, letterSpacing: "0.12em", fontSize: 18 }}>SETTINGS</h2>
          <span className="muted">
            {fps} fps · {quality}
          </span>
        </div>
        {inGame && <p className="muted" style={{ marginTop: 0 }}>The match keeps running while this menu is open.</p>}
        <div className="tabs">
          {(["graphics", "controls", "touch", "audio"] as const).map((t) => (
            <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {tab === "graphics" && (
          <>
            <Seg
              label="Quality preset"
              value={s.quality}
              options={[
                { v: "auto", l: "Auto" },
                { v: "low", l: "Low" },
                { v: "medium", l: "Med" },
                { v: "high", l: "High" },
                { v: "ultra", l: "Ultra" },
              ]}
              onChange={(v) => up({ quality: v })}
            />
            <p className="muted" style={{ margin: "6px 0" }}>
              Auto picks a preset from your GPU and steps it down/up to hold a smooth frame rate. Low: no shadows/post. Medium: shadows + bloom. High: AO, reflective floor, MSAA. Ultra: 4K
              shadows, full-res AO.
            </p>
            <Range label="Field of view" value={s.fov} min={60} max={100} step={1} onChange={(v) => up({ fov: v })} fmt={(v) => `${v}°`} />
            <Toggle label="Show FPS" value={s.showFps} onChange={(v) => up({ showFps: v })} />
          </>
        )}

        {tab === "controls" && (
          <>
            <Range label="Look sensitivity" value={s.lookSens} min={0.2} max={3} step={0.05} onChange={(v) => up({ lookSens: v })} />
            <Range label="Aim-down-sights sensitivity" value={s.adsSens} min={0.2} max={1.2} step={0.05} onChange={(v) => up({ adsSens: v })} />
            <Range label="Gamepad sensitivity" value={s.gamepadSens} min={0.3} max={2.5} step={0.05} onChange={(v) => up({ gamepadSens: v })} />
            <Toggle label="Invert Y" value={s.invertY} onChange={(v) => up({ invertY: v })} />
            <Seg label="Sprint" value={s.sprintMode} options={[{ v: "toggle", l: "Toggle" }, { v: "hold", l: "Hold" }]} onChange={(v) => up({ sprintMode: v })} />
            <Seg label="Aim (ADS)" value={s.adsMode} options={[{ v: "toggle", l: "Toggle" }, { v: "hold", l: "Hold" }]} onChange={(v) => up({ adsMode: v })} />
            <Seg label="Crouch" value={s.crouchMode} options={[{ v: "toggle", l: "Toggle" }, { v: "hold", l: "Hold" }]} onChange={(v) => up({ crouchMode: v })} />
            <div className="keys">
              <b>Keyboard &amp; mouse:</b> <kbd>WASD</kbd> move · <kbd>Mouse</kbd> aim · <kbd>LMB</kbd> fire · <kbd>RMB</kbd> aim down sights · <kbd>Shift</kbd> sprint · <kbd>Space</kbd> jump ·{" "}
              <kbd>C</kbd>/<kbd>Ctrl</kbd> crouch · <kbd>R</kbd> reload · <kbd>Esc</kbd> menu
              <br />
              <b>Gamepad:</b> left stick move · right stick aim · <kbd>RT</kbd> fire · <kbd>LT</kbd> aim · <kbd>A</kbd> jump · <kbd>B</kbd> crouch · <kbd>X</kbd> reload · <kbd>L3</kbd>/<kbd>LB</kbd> sprint ·{" "}
              <kbd>Start</kbd> menu
            </div>
          </>
        )}

        {tab === "touch" && (
          <>
            <Range label="Joystick sensitivity" value={s.joySens} min={0.6} max={1.8} step={0.05} onChange={(v) => up({ joySens: v })} />
            <Range label="Button size" value={s.buttonScale} min={0.6} max={1.6} step={0.05} onChange={(v) => up({ buttonScale: v })} />
            <Range label="Button transparency" value={s.touchOpacity} min={0.2} max={1} step={0.05} onChange={(v) => up({ touchOpacity: v })} fmt={(v) => `${Math.round(v * 100)}%`} />
            <Toggle label="Floating joystick" value={s.floatingJoystick} onChange={(v) => up({ floatingJoystick: v })} />
            <Toggle label="Auto-sprint (push stick to the edge)" value={s.autoSprint} onChange={(v) => up({ autoSprint: v })} />
            <Toggle label="Left-side fire button" value={s.layout.fireL.visible} onChange={(v) => useUI.getState().setLayout("fireL", { visible: v })} />
            <div className="row" style={{ marginTop: 12 }}>
              <button
                className="btn primary"
                onClick={() => {
                  useUI.getState().set({ settingsOpen: false, layoutEditor: true, touchMode: true });
                }}
              >
                Customize layout
              </button>
              <button className="btn" onClick={() => useUI.getState().resetLayout()}>
                Reset layout
              </button>
            </div>
            <p className="muted">In the editor, drag any control to move it and use the slider to resize it.</p>
          </>
        )}

        {tab === "audio" && <Range label="Master volume" value={s.volume} min={0} max={1} step={0.05} onChange={(v) => up({ volume: v })} fmt={(v) => `${Math.round(v * 100)}%`} />}

        <div className="row" style={{ marginTop: 16 }}>
          <button className="btn primary" onClick={close}>
            Resume
          </button>
          {inGame && (
            <button
              className="btn"
              onClick={async () => {
                if (!confirm("Leave the match? Your opponent wins by forfeit.")) return;
                await net.leave();
                location.href = location.pathname;
              }}
            >
              Leave match
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
