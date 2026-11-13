// HTTP + WebSocket entry point. One process serves the built web client and the
// Colyseus game server on the same port, so a single HTTPS deployment gives
// players both https:// and wss:// on one origin.

import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import express from "express";
import { Server, matchMaker } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { ROOM_NAME } from "../shared/constants";
import { DuelRoom } from "./DuelRoom";

const PORT = Number(process.env.PORT || 2567);
const HOST = process.env.HOST || "0.0.0.0";
const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = [process.env.PUBLIC_DIR, path.resolve(here, "../public"), path.resolve(here, "../../dist/public")].find(
  (d) => d && fs.existsSync(path.join(d, "index.html")),
);

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);

app.use((req, res, next) => {
  // Allow a separately hosted frontend (e.g. static CDN) to call the API.
  res.setHeader("Access-Control-Allow-Origin", "*");
  next();
});

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

app.get("/api/room/:code", async (req, res) => {
  const code = String(req.params.code || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);
  try {
    const rooms = await matchMaker.query({ roomId: code });
    const r = rooms[0];
    if (!r) return res.status(404).json({ exists: false });
    res.json({ exists: true, clients: r.clients, maxClients: r.maxClients, full: r.clients >= r.maxClients });
  } catch {
    res.status(500).json({ exists: false });
  }
});

if (publicDir) {
  app.use(
    "/assets",
    express.static(path.join(publicDir, "assets"), { immutable: true, maxAge: "365d", fallthrough: false }),
  );
  app.use(express.static(publicDir, { maxAge: "5m", index: false }));
  // SPA fallback: invitation links like /r/ABCDE or /?room=ABCDE load the app.
  app.get(/^\/(?!matchmake|api|healthz).*/, (_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.join(publicDir, "index.html"));
  });
} else {
  app.get("/", (_req, res) => {
    res.type("text").send("Paradox Point server is running. Build the client (npm run build) to serve the game here.");
  });
}

const httpServer = http.createServer(app);
const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer, pingInterval: 4000, pingMaxRetries: 5 }),
  greet: false,
});
gameServer.define(ROOM_NAME, DuelRoom);

await gameServer.listen(PORT, HOST);
console.log(`[paradox-point] listening on http://${HOST}:${PORT} (static: ${publicDir ?? "none"})`);

const shutdown = async () => {
  try {
    await gameServer.gracefullyShutdown(false);
  } finally {
    process.exit(0);
  }
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
