import type { Response } from "express";

// Server-Sent Events broadcaster backing GET /api/stream — see
// ARCHITECTURE.md §3 ("Real-time sync") / §12 (`GET /api/stream` — SSE
// "todos:changed" / "events:changed" / "settings:changed"). One process-wide
// set of open responses; every mutation route calls broadcast() after it
// commits, and every *other* connected client's EventSource listener
// invalidates its query cache and refetches over the normal REST API. No
// payload beyond the channel name is ever sent — clients never trust SSE
// data directly, they just re-read from SQLite, so there's nothing to keep
// in sync between the broadcast payload and the DB row shape.
const clients = new Set<Response>();

export function addClient(res: Response): void {
  clients.add(res);
}

export function removeClient(res: Response): void {
  clients.delete(res);
}

export function broadcast(channel: string): void {
  const payload = `event: ${channel}\ndata: {}\n\n`;
  for (const res of clients) {
    res.write(payload);
  }
}

export function clientCount(): number {
  return clients.size;
}
