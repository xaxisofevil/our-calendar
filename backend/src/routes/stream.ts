import { Router } from "express";
import { addClient, removeClient } from "../lib/sse.js";

export const streamRouter = Router();

// Keeps the connection alive through any intermediary (dev proxy, future
// Caddy reverse proxy) that might otherwise time out an idle response — see
// ARCHITECTURE.md §3. EventSource itself needs no keep-alive to function;
// this is purely defensive.
const HEARTBEAT_MS = 25_000;

streamRouter.get("/", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    // Disables response buffering on nginx-style proxies that respect this
    // header — harmless no-op everywhere else. Vite's dev proxy and Caddy
    // both stream through without it, but it's cheap insurance.
    "X-Accel-Buffering": "no",
  });
  res.write(":ok\n\n");

  addClient(res);

  const heartbeat = setInterval(() => {
    res.write(": heartbeat\n\n");
  }, HEARTBEAT_MS);

  req.on("close", () => {
    clearInterval(heartbeat);
    removeClient(res);
  });
});
