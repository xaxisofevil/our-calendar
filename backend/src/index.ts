import express from "express";
import { seed } from "./db/seed.js";
import { eventsRouter } from "./routes/events.js";
import { peopleRouter } from "./routes/people.js";
import { todosRouter } from "./routes/todos.js";
import { streamRouter } from "./routes/stream.js";
import { authRouter } from "./routes/auth.js";
import { requireAuth } from "./middleware/requireAuth.js";

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;

app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "our-calendar-backend" });
});

// Device-session passcode auth (ARCHITECTURE.md §5/§12, M5/M6). Mounted
// ahead of the app-wide `requireAuth` below so POST /api/auth/login stays
// reachable without a session cookie — the one other unauthenticated
// /api/* route besides GET /api/health above. (GET /api/auth/session and
// POST /api/auth/logout, also in this router, gate themselves via
// `requireAuth` per-route — see routes/auth.ts.)
app.use("/api/auth", authRouter);

// Every other /api/* route requires a valid device-session cookie from here
// down — mounted once, ahead of the CRUD/SSE routers, rather than adding
// requireAuth to each router individually. (No-ops if AUTH_PASSCODE isn't
// configured — see requireAuth's own comment for why.)
app.use("/api", requireAuth);

// SSE live-sync channel (ARCHITECTURE.md §3/§12) — mounted ahead of the
// CRUD routers only for readability; the path is distinct so order doesn't
// actually matter here.
app.use("/api/stream", streamRouter);

app.use("/api/events", eventsRouter);
app.use("/api/todos", todosRouter);
app.use("/api/people", peopleRouter);

// Minimal error handler so a thrown/rejected handler returns JSON, not an
// HTML stack trace, to a frontend that only ever expects JSON.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

// Runs on every boot; idempotent per-table (see db/seed.ts).
seed();

app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
});
