// Entry point: web server for Twilio webhooks, the live-call WebSocket, and the dashboard.
import http from "node:http";
import express from "express";
import { WebSocketServer } from "ws";
import { settings, loadBusinesses } from "./config.js";
import { twilioRoutes } from "./routes.js";
import { adminRoutes } from "./admin.js";
import { attachRelay } from "./relay.js";
import { getDb } from "./db.js";
import { syncNumberWebhooks } from "./twilio.js";

export function createServer() {
  const app = express();
  app.set("trust proxy", true);
  app.get("/", (_req, res) => res.redirect("/admin/"));
  app.get("/health", (_req, res) =>
    res.json({ ok: true, businesses: loadBusinesses().length, publicUrl: settings.publicUrl || null, model: settings.model })
  );
  app.get("/admin", (req, res, next) => (req.path === "/admin" && !req.originalUrl.startsWith("/admin/") ? res.redirect("/admin/") : next()));
  app.use("/admin", adminRoutes());
  app.use("/", twilioRoutes());

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });
  attachRelay(wss);
  server.on("upgrade", (req, socket, head) => {
    if (!req.url.startsWith("/relay")) return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  getDb();
  const problems = [];
  if (!settings.publicUrl) problems.push("PUBLIC_URL is not set (Twilio can't reach this server)");
  if (!settings.twilioSid || !settings.twilioToken) problems.push("TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN not set");
  if (!process.env.ANTHROPIC_API_KEY) problems.push("ANTHROPIC_API_KEY not set");
  if (!loadBusinesses().length) problems.push("no businesses in config/businesses.json");
  createServer().listen(settings.port, async () => {
    console.log(`Receptionist listening on port ${settings.port}`);
    for (const p of problems) console.warn(`WARNING: ${p}`);
    for (const line of await syncNumberWebhooks()) console.log(line);
  });
}
