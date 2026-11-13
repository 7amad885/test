import { useEffect, useRef } from "react";
import * as THREE from "three";
import { LOOPS_PER_ROUND, RIFLE, ROUNDS_TO_WIN, SIDE_COLORS, SIDE_NAMES } from "../../shared/constants";
import { POINT_CENTER } from "../../shared/map";
import { input } from "../input/InputManager";
import { game, useHud } from "../game/runtime";
import { useUI } from "../store";

const Gear = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </svg>
);

function Pips({ n, color }: { n: number; color: string }) {
  return (
    <div className="pips" style={{ color }}>
      {Array.from({ length: ROUNDS_TO_WIN }, (_, i) => (
        <div key={i} className={`pip ${i < n ? "on" : ""}`} />
      ))}
    </div>
  );
}

function PingBars({ ms }: { ms: number }) {
  const lvl = ms < 70 ? 4 : ms < 120 ? 3 : ms < 200 ? 2 : 1;
  const col = lvl >= 3 ? "#7dff9e" : lvl === 2 ? "#ffd36b" : "#ff6b6b";
  return (
    <span className="bars" style={{ color: col }}>
      {[4, 7, 10, 13].map((h, i) => (
        <i key={i} className={i < lvl ? "on" : ""} style={{ height: h }} />
      ))}
    </span>
  );
}

export function Hud() {
  const h = useHud();
  const feed = useUI((s) => s.feed);
  const ann = useUI((s) => s.announcement);
  const fps = useUI((s) => s.fps);
  const showFps = useUI((s) => s.settings.showFps);
  const quality = useUI((s) => s.quality);
  const touch = useUI((s) => s.touchMode);
  const my = h.side;
  const op = 1 - my;
  const meterPct = Math.abs(h.meter) / 2; // 0..50% of width
  const meterColor = h.meter >= 0 ? SIDE_COLORS[0] : SIDE_COLORS[1];
  const capText =
    h.phase !== "loop"
      ? ""
      : h.capture === 2
        ? "CONTESTED"
        : h.capture === my
          ? "CAPTURING"
          : h.capture === op
            ? "ENEMY CAPTURING"
            : Math.abs(h.meter) < 0.5
              ? "POINT NEUTRAL"
              : (h.meter > 0 ? 0 : 1) === my
                ? "YOU LEAD"
                : "ENEMY LEADS";
  const capColor = h.capture === 2 ? "#ff4d6d" : h.capture === my ? SIDE_COLORS[my] : h.capture === op ? SIDE_COLORS[op] : "#c9d6e6";
  const now = performance.now();
  const recentFeed = feed.filter((f) => now - f.t < 7000);
  const t = Math.ceil(h.timeLeft);
  const timeStr = h.phase === "loop" ? `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}` : h.phase === "countdown" ? String(t) : h.phase === "rewind" ? "⟲" : "";

  return (
    <div className="hud">
      <div className="top">
        <div className="score">
          <span className="nm" style={{ color: SIDE_COLORS[0] }}>
            {h.side === 0 ? h.myName : h.oppName || SIDE_NAMES[0]}
          </span>
          <Pips n={h.wins[0]} color={SIDE_COLORS[0]} />
          <div className="clock">
            <div className="t">{timeStr}</div>
            <div className="loops">
              {Array.from({ length: LOOPS_PER_ROUND }, (_, i) => (
                <span key={i} className={i + 1 === h.loop ? "on" : i + 1 < h.loop ? "done" : ""} />
              ))}
            </div>
            <div style={{ fontSize: 9, letterSpacing: "0.15em", color: "#9fb3c8" }}>
              R{h.round} · LOOP {h.loop || 1}
            </div>
          </div>
          <Pips n={h.wins[1]} color={SIDE_COLORS[1]} />
          <span className="nm" style={{ color: SIDE_COLORS[1] }}>
            {h.side === 1 ? h.myName : h.oppName || SIDE_NAMES[1]}
          </span>
        </div>
        <div className="meter">
          <div className="fill" style={{ background: meterColor, boxShadow: `0 0 10px ${meterColor}`, ...(h.meter >= 0 ? { left: "50%", width: `${meterPct}%` } : { right: "50%", width: `${meterPct}%` }) }} />
          <div className="mid" />
        </div>
        <div className="capline" style={{ color: capColor }}>
          {capText}
        </div>
        {h.phase === "loop" && (
          <div className="echoes">
            Your echoes {h.echoes[my]}
            {h.anomalies[my] ? ` +${h.anomalies[my]} anomaly` : ""} · Enemy echoes {h.echoes[op]}
            {h.anomalies[op] ? ` +${h.anomalies[op]} anomaly` : ""}
          </div>
        )}
      </div>

      <div className="feed">
        {recentFeed.map((f) => (
          <div key={f.id} style={{ color: f.color }}>
            <span style={{ color: "#e8f1fb" }}>
              {f.icon ? `${f.icon} ` : ""}
              {f.text}
            </span>
          </div>
        ))}
      </div>

      <div className="netinfo">
        <div>
          {h.ping} ms <PingBars ms={h.ping} />
        </div>
        {h.oppName && (
          <div style={{ opacity: 0.8 }}>
            {h.oppName}: {h.oppConnected ? `${h.oppPing} ms` : "offline"} {h.oppDevice ? `· ${h.oppDevice}` : ""}
          </div>
        )}
        {showFps && (
          <div>
            {fps} fps · {quality}
          </div>
        )}
      </div>
      <button className="gear" onClick={() => useUI.getState().set({ settingsOpen: true })} aria-label="Settings">
        <Gear />
      </button>

      {h.phase === "loop" && h.alive && (
        <div className="vitals" style={touch ? { bottom: "calc(4px + var(--safe-b))" } : undefined}>
          <div className="hp">
            <div className="num" style={{ color: h.hp < 35 ? "#ff6b6b" : "#fff" }}>
              {h.hp}
              <small style={{ fontSize: 11, color: "#8ea0b6" }}> HP</small>
            </div>
            <div className="bar">
              <div style={{ width: `${h.hp}%`, background: h.hp < 35 ? "#ff4d6d" : SIDE_COLORS[my] }} />
            </div>
          </div>
          <div className="ammo">
            <div className="rl">{h.reloading ? "RELOADING" : h.ammo === 0 ? "EMPTY" : h.ammo <= 8 ? "LOW AMMO" : " "}</div>
            <div className="num">
              {h.ammo}
              <small> / {RIFLE.magSize}</small>
            </div>
          </div>
        </div>
      )}

      {h.phase === "loop" && !h.alive && (
        <div className="center-msg">
          <div style={{ fontSize: 22, color: "#ff6b6b" }}>YOUR TIMELINE ENDED</div>
          <div style={{ fontSize: 14, color: "#dbe7f5" }}>{h.respawnIn > 0 ? `Re-entering this loop in ${Math.ceil(h.respawnIn)}s` : "Out until the next loop"}</div>
        </div>
      )}
      {h.phase === "countdown" && (
        <div className="center-msg" style={{ top: "40%" }}>
          <div style={{ fontSize: 64, fontWeight: 900 }}>{Math.max(1, Math.ceil(h.timeLeft))}</div>
        </div>
      )}

      {ann && (
        <div className="announce" key={ann.id} style={{ color: ann.color ?? "#fff" }}>
          <h1>{ann.title}</h1>
          {ann.sub && <p>{ann.sub}</p>}
        </div>
      )}

      <FastHud />
      {!touch && !input.pointerLocked && (h.phase === "loop" || h.phase === "countdown") && <ClickToPlay />}
    </div>
  );
}

function ClickToPlay() {
  return (
    <div
      className="center-msg"
      style={{ top: "70%", pointerEvents: "auto", cursor: "pointer", background: "rgba(5,10,18,0.7)", padding: "10px 16px", borderRadius: 12, border: "1px solid rgba(160,210,255,0.25)" }}
      onClick={() => {
        const c = document.querySelector("canvas");
        const r = c?.requestPointerLock?.() as unknown as Promise<void> | undefined;
        r?.catch?.(() => {});
      }}
    >
      CLICK TO AIM · WASD move · Shift sprint · Space jump · C crouch · R reload · RMB aim · Esc menu
    </div>
  );
}

/** 60 Hz HUD pieces updated imperatively (no React re-render). */
function FastHud() {
  const cross = useRef<HTMLDivElement>(null);
  const hit = useRef<HTMLDivElement>(null);
  const dmg = useRef<HTMLDivElement>(null);
  const marker = useRef<HTMLDivElement>(null);
  const dmgFx = useRef<HTMLDivElement>(null);
  const rwFx = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const v = new THREE.Vector3();
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const now = game.now;
      const H = window.innerHeight;
      const loopPhase = game.phase === "loop" && game.alive;
      // crosshair
      if (cross.current) {
        const spreadPx = (Math.tan(game.spread) / Math.tan(((game.camera?.fov ?? 78) * Math.PI) / 360)) * (H / 2);
        const gap = 4 + spreadPx;
        const kids = cross.current.children as HTMLCollectionOf<HTMLElement>;
        const vis = loopPhase && game.adsBlend < 0.6 && !game.sprinting;
        cross.current.style.opacity = vis ? String(1 - game.adsBlend) : "0";
        const L = 9;
        kids[0].style.cssText = `width:2px;height:${L}px;left:-1px;top:${-gap - L}px`;
        kids[1].style.cssText = `width:2px;height:${L}px;left:-1px;top:${gap}px`;
        kids[2].style.cssText = `height:2px;width:${L}px;top:-1px;left:${-gap - L}px`;
        kids[3].style.cssText = `height:2px;width:${L}px;top:-1px;left:${gap}px`;
      }
      // hitmarker
      if (hit.current) {
        const k = 1 - (now - game.hitmarkerT) / 0.25;
        const kill = now - game.killT < 0.4;
        hit.current.style.opacity = String(Math.max(0, k));
        const col = kill ? "#ff4d6d" : game.hitHead ? "#ffd36b" : "#fff";
        for (const el of hit.current.children as HTMLCollectionOf<HTMLElement>) el.style.background = col;
        hit.current.style.transform = `scale(${1 + Math.max(0, k) * 0.3})`;
      }
      // damage direction indicators
      if (dmg.current) {
        game.dmgIndicators = game.dmgIndicators.filter((d) => now - d.t < 1.4);
        const els = dmg.current.children as HTMLCollectionOf<HTMLElement>;
        for (let i = 0; i < els.length; i++) {
          const d = game.dmgIndicators[i];
          if (!d) {
            els[i].style.opacity = "0";
            continue;
          }
          const rel = -(d.yaw - game.yaw);
          els[i].style.opacity = String(1 - (now - d.t) / 1.4);
          els[i].style.transform = `rotate(${rel}rad)`;
        }
      }
      // capture point marker
      if (marker.current && game.camera) {
        const show = game.phase === "loop" || game.phase === "countdown";
        marker.current.style.display = show ? "block" : "none";
        if (show) {
          v.set(POINT_CENTER.x, 3.4, POINT_CENTER.z).project(game.camera);
          let x = (v.x * 0.5 + 0.5) * window.innerWidth;
          let y = (-v.y * 0.5 + 0.5) * H;
          if (v.z > 1) {
            x = window.innerWidth - x;
            y = H - 40;
          }
          x = Math.max(30, Math.min(window.innerWidth - 30, x));
          y = Math.max(90, Math.min(H - 60, y));
          const dist = Math.hypot(game.renderPos.x - POINT_CENTER.x, game.renderPos.z - POINT_CENTER.z);
          marker.current.style.left = `${x}px`;
          marker.current.style.top = `${y}px`;
          const s = useHud.getState();
          const c = s.capture === 2 ? "#ff4d6d" : s.capture === 0 || s.capture === 1 ? SIDE_COLORS[s.capture] : "#e8f1fb";
          marker.current.style.color = c;
          (marker.current.lastChild as HTMLElement).textContent = dist < 4.6 ? "ON POINT" : `${Math.round(dist)} m`;
        }
      }
      // CSS fallbacks for the post-processing effects (also used on Low)
      const q = useUI.getState().quality;
      if (dmgFx.current) dmgFx.current.style.opacity = q === "low" ? String(Math.min(0.9, game.damageFlash)) : "0";
      if (rwFx.current) rwFx.current.style.opacity = game.phase === "rewind" ? String(Math.sin(game.rewindProgress * Math.PI) * (q === "low" ? 1 : 0.4)) : "0";
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <>
      <div className="fx-damage" ref={dmgFx} />
      <div className="fx-rewind" ref={rwFx} />
      <div className="crosshair" ref={cross}>
        <i />
        <i />
        <i />
        <i />
        <i className="dot" />
      </div>
      <div className="hitmarker" ref={hit}>
        <i style={{ left: 0, transform: "rotate(45deg) translateX(-3px)" }} />
        <i style={{ right: 0, transform: "rotate(-45deg) translateX(3px)" }} />
        <i style={{ left: 0, transform: "rotate(-45deg) translateX(-3px)" }} />
        <i style={{ right: 0, transform: "rotate(45deg) translateX(3px)" }} />
      </div>
      <div className="dmg" ref={dmg}>
        {Array.from({ length: 6 }, (_, i) => (
          <i key={i} />
        ))}
      </div>
      <div className="marker" ref={marker}>
        <div className="dia" />
        <div>POINT</div>
      </div>
    </>
  );
}
