# PARADOX POINT

A mobile-first, real-time **online 1v1 time-loop FPS** for the browser. Two players on any mix of
iPhone, Android, tablet or PC fight over a capture point across three time loops — while
holographic *echoes* of their past selves replay everything they did.

Stack: **Three.js + React Three Fiber** (client) · **Colyseus 0.16 over WebSockets** (authoritative
server) · TypeScript everywhere · one Node process serves both the game page and the WSS endpoint.

---

## Play it (how the flow works)

1. Open the site → enter a username → **Create Private Match**.
2. You get a 5-character **room code** and an **invite link** (`https://<host>/?room=ABCDE`).
   **Share invite** opens the phone's share sheet (WhatsApp, iMessage …); there are also WhatsApp
   and Copy buttons.
3. Your friend opens the link on any device/network → enters a name → **Join friend's match**.
4. Both tap **Ready** (on phones this also requests full-screen + landscape lock).
5. Fight. First to **3 rounds** wins. **Rematch** keeps you in the same room.

No install, no account. iPhone tip: Share → *Add to Home Screen* gives true full-screen (iOS Safari
does not allow element full-screen on iPhone).

## Rules (the time-loop design)

> Sections 1–11 of the original brief were not available, so the rules below were designed from
> what sections 12–15 require (three loops, clones, paradoxes, capture-the-point, first-to-three).

* **Round = 3 loops of 35 s.** Everything each player does in a loop — movement, aim, every shot —
  is recorded by the server.
* **Rewind.** When a loop ends, time rewinds (cinematic: your camera flies backwards along your own
  path, the world desaturates and tears). In the next loop, each recorded life replays as an
  **echo** (cyan/ember hologram) alongside the live players. Loop 3 has both earlier loops' echoes.
* **Causality is re-simulated, not scripted.** Echo shots are re-fired from their recorded aim
  against the *current* timeline:
  * Kill an enemy echo before it fires → its future never happens: **TIMELINE ERASED** (it becomes
    a dissolving **ghost**).
  * If the shooter that originally killed one of *your* echoes is erased, your echo outlives its
    recorded death: **PARADOX — rescued**. It becomes an **anomaly** (glitching gold/violet) that
    holds its position and defends itself with automatic burst fire.
  * Stand in the line of a recorded shot and you **body-block** it (it hits you instead).
  * If history plays out unchanged, the death is **fulfilled** ("history repeats").
* **Death** ends your current *life track*; you re-enter the same loop after 4 s (each life becomes
  its own echo later).
* **Paradox Point (capture).** A tug-of-war meter from −100 to +100 that persists across the
  round's loops. Any alive unit counts — live player, echoes and anomalies (more units = faster:
  ×1, ×1.5, ×2 …). Both sides present = **contested** (no progress). Full meter wins the round
  instantly; otherwise after loop 3 the side the meter leans to wins the round (exactly 0 = draw).
* **First to 3 round wins** takes the match. Disconnects freeze time for both players for up to
  45 s; no return = forfeit.

## Controls

| Action | Touch | Keyboard & mouse | Gamepad |
|---|---|---|---|
| Move | left floating joystick (push to the rim = auto-sprint) | WASD | left stick |
| Aim | drag anywhere on the right side | mouse (pointer lock) | right stick |
| Fire (hold = auto) | big right fire button — *drag while holding it to aim* — or the optional left fire button | LMB | RT |
| Aim down sights | eye button (toggle/hold) | RMB | LT |
| Jump | ↑ button | Space | A |
| Crouch | ↓ button (toggle/hold) | C / Ctrl | B |
| Sprint | » button (toggle/hold) | Shift | L3 / LB |
| Reload | ⟳ button | R | X |
| Settings / pause menu | ⚙ | Esc | Start |

Touch is auto-detected (and switches live between touch and mouse). Settings → **Touch** lets players
change joystick sensitivity, button size, transparency, toggle/hold modes, and open the **layout
editor** to drag every control to a new position and resize it individually (saved per device).
Multi-touch is handled per pointer, so moving, aiming and shooting work simultaneously. Page
scroll, pinch/double-tap zoom, text selection and the long-press menu are suppressed in game.

## Graphics

All textures, models and sounds are **generated procedurally at runtime** (original content, no
third-party assets): tileable fBm PBR sets (concrete, panelled metal, floor, cargo crates, armor,
gunmetal) with normal + roughness/metalness maps, an extruded hard-surface rifle with holo sight,
rails, curved mag and muzzle brake, and an articulated armored operator with IK arms.

* Image-based reflections from a baked light-former environment, PBR materials, soft shadows,
  N8AO ambient occlusion, mip-mapped bloom, planar reflective floor, fake volumetric shafts, dust,
  fog, holographic signage, a rotating chrono-ring set piece and a lit megacity skyline.
* Custom shaders: echo/anomaly/ghost/rewind holograms, the capture ring, sky, paradox shockwaves,
  and a single "temporal" post pass (chromatic split, tearing, swirl, damage burn, ACES tone map,
  split-tone grade, vignette, grain).
* Weapon handling: sway, bob, spring recoil, ADS aligned to the holo-sight reticle, sprint pose,
  full reload choreography, muzzle flash + light, ejected shells, tracers, sparks, bullet holes
  (they vanish when time rewinds), hit markers, damage direction arcs.
* **Presets Low / Medium / High / Ultra** + **Auto**: picks a tier from the GPU (Apple, Adreno,
  Mali, desktop…), then a frame-rate monitor steps quality/resolution down (or up) to hold ~60 fps
  (≥30 floor). Characters use two LOD levels; architecture is merged into a handful of draw calls;
  tracers/decals/shells are instanced.

## Networking

* Server-authoritative 30 Hz simulation (`src/server/sim.ts`), 20 Hz delta-compressed state
  patches, events (shots/hits/kills/paradoxes) pushed immediately.
* Movement: client sends fixed-step inputs; the server re-simulates them with the *same* shared
  physics (`src/shared/physics.ts`) under a time budget (no speed hacks). The client predicts
  locally and reconciles to `lastSeq` with smoothing.
* Shooting: server hitscan with **lag compensation** (rewinds hitboxes up to 280 ms), validates
  ammo, reload state, rate of fire (token bucket tolerant to mobile jitter) and that the shot lies
  within the weapon's spread cone. Damage, deaths, timeline replay, paradoxes, capture and scoring
  are all decided on the server.
* Remote units are interpolated 110 ms in the past against a synchronised server clock.
* Ping shown for both players; disconnect → automatic reconnection to the same seat (token kept in
  `sessionStorage`, so a page refresh also resumes).

## Develop & test

```bash
npm install
npm run dev          # server on :2567 + Vite on :5173 (open http://localhost:5173)
npm test             # 17 unit tests: physics, 3-loop replay, erase/rescue/fulfil, body-block, capture, scoring, forfeit
npm run build && npm start   # production: http://localhost:2567 serves game + WebSocket
npm run test:e2e     # with the server running: iPhone (touch via CDP) vs desktop browsers, + deterministic protocol test
```

`tests/e2e/two-players.mjs` creates a room on an emulated iPhone, joins via the invite link from a
desktop browser, readies up, then checks touch joystick movement, touch aiming, firing while moving
and aiming, jump/crouch/reload, prediction vs. server position, desktop WASD, server-validated hits
and kills, the rewind, loop-2 echoes, latency and reconnection. `tests/e2e/visual-qa.mjs` renders
posed characters and the viewmodel at a chosen preset for visual review.

## Deploy (HTTPS + WSS)

The game needs one always-on Node process with WebSockets. It must run as a **single instance**
(rooms live in memory). The included `Dockerfile` builds the client and server into one image;
the host provides TLS, so players get `https://` and `wss://` on the same origin.

**Render (simplest, from GitHub):** Render → *New* → *Web Service* → this repository, branch
`paradox-point`, Runtime **Docker** (Root Directory empty), health check `/healthz`, one instance —
or *New* → *Blueprint*, which reads `render.yaml`. The URL Render gives you
(`https://paradox-point-xxxx.onrender.com`) *is* the game — share invites from it. The free plan
works but sleeps after ~15 min idle (first load then takes ~1 min); `starter` stays awake.

**Fly.io:**
```bash
fly launch --copy-config --no-deploy   # pick a unique app name / region
fly deploy
```

**Any VPS / container host:** `docker build -t paradox-point . && docker run -p 80:8080 paradox-point`
behind a TLS proxy (Caddy/nginx/Cloudflare) — WebSocket upgrade must be allowed.

**Split hosting (optional):** host `dist/public` on a static CDN and point it at the game server
with `VITE_SERVER_URL=https://your-server npm run build:client`, or append
`?server=https://your-server` to the page URL. Invite links carry the `server` parameter along.

Health check: `GET /healthz`. Room lookup: `GET /api/room/:code`.

## Layout

```
src/shared/   constants, arena map (collision = visuals), physics, protocol
src/server/   index.ts (express + Colyseus), DuelRoom.ts, sim.ts (all game rules), schema.ts
src/client/   net/ (Colyseus client, clock sync, interpolation), game/ (runtime prediction, R3F scene,
              arena, characters, weapon, effects, post, shaders, procedural textures, quality),
              input/ (keyboard/mouse/touch/gamepad), ui/ (menus, lobby, HUD, touch controls, settings)
tests/        unit tests (vitest) and browser e2e tests (Playwright)
```
