import { useEffect, useState } from "react";
import { SIDE_COLORS, SIDE_NAMES } from "../../shared/constants";
import { audio } from "../audio";
import { game, useHud } from "../game/runtime";
import { isMobileDevice } from "../game/quality";
import { net, resolveServerUrl } from "../net/NetClient";
import { useUI } from "../store";

export function deviceLabel(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua))) return "iPad";
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? "Android" : "Tablet";
  if (/Mac/.test(ua)) return "Mac";
  return "PC";
}

export function inviteCodeFromUrl(): string | null {
  const p = new URLSearchParams(location.search).get("room");
  const m = location.pathname.match(/\/r\/([A-Za-z0-9]{4,8})/);
  const c = (p || m?.[1] || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return c || null;
}

export function inviteUrl(code: string): string {
  const u = new URL(location.origin + "/");
  u.searchParams.set("room", code);
  const server = new URLSearchParams(location.search).get("server");
  if (server) u.searchParams.set("server", server);
  return u.toString();
}

function setUrlRoom(code: string | null) {
  const u = new URL(location.href);
  if (code) u.searchParams.set("room", code);
  else u.searchParams.delete("room");
  history.replaceState(null, "", u.toString());
}

function friendlyError(e: unknown): string {
  const msg = String((e as Error)?.message || e || "");
  if (/not found|invalid|expired/i.test(msg)) return "That match no longer exists. Ask your friend for a new invite link.";
  if (/full|locked/i.test(msg)) return "That match is already full.";
  if (/fetch|network|ECONN|Failed/i.test(msg)) return "Can't reach the game server. Check your connection and try again.";
  return msg || "Something went wrong.";
}

async function goFullscreenLandscape() {
  if (!isMobileDevice()) return;
  try {
    const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };
    if (!document.fullscreenElement) await (el.requestFullscreen?.({ navigationUI: "hide" }) ?? el.webkitRequestFullscreen?.());
  } catch {
    /* iPhone Safari has no element fullscreen; the rotate overlay + PWA mode cover it */
  }
  try {
    await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> })?.lock?.("landscape");
  } catch {
    /* not supported everywhere */
  }
}

export function Home() {
  const [name, setName] = useState(useUI.getState().name);
  const invite = inviteCodeFromUrl();
  const [code, setCode] = useState(invite ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [joining, setJoining] = useState(!!invite);

  useEffect(() => {
    // returning after a refresh: silently resume the same seat
    if (!invite) return;
    void net.resume(invite).then((ok) => {
      if (ok) useUI.getState().setScreen("lobby");
    });
  }, [invite]);

  const go = async (mode: "create" | "join") => {
    audio.unlock();
    const n = name.trim().slice(0, 16);
    if (!n) return setErr("Enter a username first.");
    localStorage.setItem("paradox-point:name", n);
    useUI.setState({ name: n });
    setBusy(true);
    setErr(null);
    try {
      if (mode === "create") await net.create(n, deviceLabel());
      else {
        const c = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
        if (c.length < 4) throw new Error("Enter the 5-character room code.");
        await net.join(c, n, deviceLabel());
      }
      setUrlRoom(net.code);
      useUI.getState().setScreen("lobby");
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="menu-wrap">
      <div className="panel">
        <h1 className="logo">PARADOX POINT</h1>
        <p className="tagline">Online 1v1 time-loop shooter · three loops · your past selves fight beside you</p>
        <div className="field">
          <label htmlFor="name">Username</label>
          <input id="name" className="input" maxLength={16} value={name} placeholder="Your name" autoComplete="nickname" onChange={(e) => setName(e.target.value)} />
        </div>
        {invite || joining ? (
          <>
            <div className="field">
              <label htmlFor="code">Room code</label>
              <input id="code" className="input" value={code} maxLength={8} placeholder="ABCDE" autoCapitalize="characters" style={{ letterSpacing: "0.3em", fontWeight: 800 }} onChange={(e) => setCode(e.target.value.toUpperCase())} />
            </div>
            {err && <div className="error">{err}</div>}
            <div className="row">
              <button className="btn ember" disabled={busy} onClick={() => go("join")}>
                {busy ? "Joining…" : invite ? "Join friend's match" : "Join match"}
              </button>
              <button
                className="btn"
                disabled={busy}
                onClick={() => {
                  setJoining(false);
                  setUrlRoom(null);
                }}
              >
                Create my own instead
              </button>
            </div>
          </>
        ) : (
          <>
            {err && <div className="error">{err}</div>}
            <div className="row">
              <button className="btn primary" disabled={busy} onClick={() => go("create")}>
                {busy ? "Creating…" : "Create Private Match"}
              </button>
              <button className="btn" disabled={busy} onClick={() => setJoining(true)}>
                Join with code
              </button>
            </div>
          </>
        )}
        <div className="howto">
          <b>How it works.</b> Each round has <b>3 loops of 35 s</b>. Everything you do is recorded. When a loop ends, time rewinds and your past self replays as an <b>echo</b>{" "}
          beside you — moving and shooting exactly as you did. Kill an enemy echo before it fires and its future never happens (<b>timeline erased</b>). Save your own echo from its
          recorded death and it becomes an <b>anomaly</b> that defends itself. Echoes count on the <b>Paradox Point</b>: hold it to push the meter. Full meter wins instantly; otherwise
          whoever leads after loop 3 takes the round. <b>First to 3 rounds.</b>
        </div>
        <p className="muted" style={{ marginTop: 10 }}>
          No install or account. Works on iPhone, Android, tablets and PC — play in landscape.
        </p>
      </div>
    </div>
  );
}

export function useRoomTick(hz = 8) {
  const [, f] = useState(0);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = net.onState(() => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        f((x) => x + 1);
      }, 1000 / hz);
    });
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
  }, [hz]);
}

interface PlayerView {
  id: string;
  name: string;
  side: number;
  ready: boolean;
  connected: boolean;
  ping: number;
  device: string;
}

function players(): PlayerView[] {
  const out: PlayerView[] = [];
  net.state?.players.forEach((p: PlayerView) => out.push({ id: p.id, name: p.name, side: p.side, ready: p.ready, connected: p.connected, ping: p.ping, device: p.device }));
  return out;
}

export function Lobby() {
  useRoomTick();
  const [copied, setCopied] = useState(false);
  const code = net.code;
  const link = inviteUrl(code);
  const list = players();
  const me = list.find((p) => p.id === net.me);
  const name = me?.name ?? useUI.getState().name;
  const text = `${name} challenged you to a 1v1 time-loop duel in Paradox Point. Room ${code}:`;
  const ios = /iPhone|iPad/.test(navigator.userAgent);
  const standalone = matchMedia("(display-mode: fullscreen), (display-mode: standalone)").matches;

  const share = async () => {
    audio.unlock();
    if ("share" in navigator) {
      try {
        await navigator.share({ title: "Paradox Point — 1v1", text, url: link });
        return;
      } catch {
        /* cancelled */
      }
    }
    copy();
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = link;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const slot = (side: number) => {
    const p = list.find((x) => x.side === side);
    return (
      <div className={`slot ${p?.ready ? "is-ready" : ""}`} style={{ borderColor: p ? SIDE_COLORS[side] + "88" : undefined }}>
        <div className="side" style={{ color: SIDE_COLORS[side] }}>
          {SIDE_NAMES[side]}
        </div>
        <div className="name">{p ? p.name + (p.id === net.me ? " (you)" : "") : "Waiting…"}</div>
        <div className="meta">{p ? `${p.device || "device"} · ${p.connected ? `${p.ping} ms` : "reconnecting"}` : "Share the link below"}</div>
      </div>
    );
  };

  return (
    <div className="menu-wrap">
      <div className="panel">
        <div className="muted" style={{ textAlign: "center", letterSpacing: "0.2em" }}>
          PRIVATE MATCH · ROOM CODE
        </div>
        <div className="code">{code}</div>
        <div className="link">{link}</div>
        <div className="row">
          <button className="btn primary" onClick={share}>
            {"share" in navigator ? "Share invite" : copied ? "Link copied!" : "Copy invite link"}
          </button>
          <a className="btn" style={{ textAlign: "center", textDecoration: "none", background: "#1fae5b", color: "#03140a", border: "none" }} href={`https://wa.me/?text=${encodeURIComponent(`${text} ${link}`)}`} target="_blank" rel="noreferrer">
            WhatsApp
          </a>
          <button className="btn" onClick={copy}>
            {copied ? "Copied!" : "Copy link"}
          </button>
        </div>
        <div className="slots">
          {slot(0)}
          {slot(1)}
        </div>
        <div className="row">
          <button
            className={`btn ${me?.ready ? "ready" : "ember"}`}
            disabled={!me}
            onClick={() => {
              audio.unlock();
              audio.ui();
              net.setReady(!me?.ready);
              if (!me?.ready) void goFullscreenLandscape();
            }}
          >
            {me?.ready ? "Ready ✓ (tap to cancel)" : "Ready"}
          </button>
          <button
            className="btn"
            onClick={async () => {
              await net.leave();
              setUrlRoom(null);
              useUI.getState().setScreen("home");
            }}
          >
            Leave
          </button>
        </div>
        <p className="muted" style={{ textAlign: "center" }}>
          {list.length < 2 ? "Waiting for your opponent to open the link…" : list.every((p) => p.ready) ? "Starting…" : "The match starts when both players are ready."}
        </p>
        {ios && !standalone && (
          <p className="muted" style={{ textAlign: "center" }}>
            iPhone tip: Share → “Add to Home Screen” launches the game true full-screen.
          </p>
        )}
        <p className="muted" style={{ textAlign: "center", fontSize: 11 }}>Server: {resolveServerUrl().replace(/^http/, "ws")}</p>
      </div>
    </div>
  );
}

export function GameOverlays() {
  const h = useHud();
  useRoomTick(4);
  const list = players();
  const me = list.find((p) => p.id === net.me);
  const opp = list.find((p) => p.id !== net.me);

  if (!h.connected && !h.reconnecting && !net.room?.connection.isOpen) {
    return (
      <div className="overlay">
        <div className="panel" style={{ textAlign: "center" }}>
          <h2>Connection lost</h2>
          <p className="muted">The match could not be resumed.</p>
          <button className="btn primary" onClick={() => (location.href = location.pathname)}>
            Back to menu
          </button>
        </div>
      </div>
    );
  }
  if (h.reconnecting) {
    return (
      <div className="overlay">
        <div className="panel" style={{ textAlign: "center" }}>
          <h2>Reconnecting…</h2>
          <p className="muted">Your seat is held for 45 seconds. The match is paused for both players.</p>
        </div>
      </div>
    );
  }
  if (h.phase === "matchEnd") {
    const won = h.matchWinner === h.side;
    return (
      <div className="overlay">
        <div className="panel" style={{ textAlign: "center" }}>
          <h1 style={{ margin: 0, letterSpacing: "0.15em", color: won ? SIDE_COLORS[h.side] : "#ff6b6b" }}>{won ? "VICTORY" : "DEFEAT"}</h1>
          <p className="muted">
            {h.endReason === "forfeit" ? (won ? "Your opponent left the match." : "You left the match.") : `${h.wins[0]} – ${h.wins[1]} in rounds`}
          </p>
          <div className="statgrid">
            <span className="h">PLAYER</span>
            <span className="h">KILLS</span>
            <span className="h">DEATHS</span>
            <span className="h">ERASED</span>
            <span className="h">RESCUED</span>
            {h.stats.map((s) => (
              <FragmentRow key={s.name + s.side} s={s} />
            ))}
          </div>
          <div className="row">
            {opp && h.endReason !== "forfeit" && (
              <button className={`btn ${me?.ready ? "ready" : "primary"}`} onClick={() => net.setReady(!me?.ready)}>
                {me?.ready ? "Waiting for rematch…" : "Rematch"}
              </button>
            )}
            <button className="btn" onClick={async () => {
              await net.leave();
              location.href = location.pathname;
            }}>
              Leave
            </button>
          </div>
          {opp?.ready && !me?.ready && <p style={{ color: "#8bffbf" }}>{opp.name} wants a rematch!</p>}
        </div>
      </div>
    );
  }
  if (h.paused) {
    return (
      <div className="overlay">
        <div className="panel" style={{ textAlign: "center" }}>
          <h2>Opponent disconnected</h2>
          <p className="muted">Time is frozen. Waiting {Math.ceil(h.pauseLeft)} s for them to reconnect, otherwise you win by forfeit.</p>
        </div>
      </div>
    );
  }
  return null;
}

function FragmentRow({ s }: { s: { name: string; side: number; kills: number; deaths: number; erased: number; rescued: number } }) {
  return (
    <>
      <span style={{ color: SIDE_COLORS[s.side], textAlign: "left", fontWeight: 800 }}>{s.name}</span>
      <span>{s.kills}</span>
      <span>{s.deaths}</span>
      <span>{s.erased}</span>
      <span>{s.rescued}</span>
    </>
  );
}

export function RotateHint() {
  return (
    <div className="rotate active">
      <div className="phone" />
      <h2 style={{ margin: 0 }}>Rotate to landscape</h2>
      <p className="muted">Paradox Point is played in landscape for two-thumb controls.</p>
    </div>
  );
}

export { game };
