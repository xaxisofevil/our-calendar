import express from "express";
import helmet from "helmet";
import { seed } from "./db/seed.js";
import { eventsRouter } from "./routes/events.js";
import { peopleRouter } from "./routes/people.js";
import { todosRouter } from "./routes/todos.js";
import { streamRouter } from "./routes/stream.js";
import { authRouter } from "./routes/auth.js";
import { pushRouter } from "./routes/push.js";
import { voiceRouter } from "./routes/voice.js";
import { requireAuth } from "./middleware/requireAuth.js";
import { scanAndSendReminders } from "./lib/reminders.js";
import { REMINDER_SCAN_INTERVAL_MS } from "./lib/constants.js";

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;

// §5/§6 hardening: in production this process only ever receives traffic
// from Caddy's reverse proxy, running on the same machine (§6) — trusting
// exactly one hop makes Express resolve req.ip from the X-Forwarded-For
// header Caddy sets, rather than seeing every request as coming from
// Caddy's own localhost address. Without this, the login rate limiter
// below would share one bucket across every real visitor instead of
// limiting per actual client. Harmless in dev (no proxy in front, so
// there's no X-Forwarded-For to trust).
app.set("trust proxy", 1);

// Baseline security headers (X-Frame-Options, X-Content-Type-Options,
// etc.) — near-zero config/maintenance cost, standard practice for
// anything reachable from the internet.
//
// Two defaults turned off, both empirically isolated (bisected each of
// helmet's default policies against the full e2e suite, not guessed):
// - `contentSecurityPolicy: false` — helmet's default CSP assumes a
//   classic server-rendered page; it doesn't match this SPA's Vite-built
//   bundle. A hand-tuned CSP is a reasonable future addition, not required
//   here.
// - `crossOriginOpenerPolicy: false` — this specific policy (not
//   crossOriginResourcePolicy, not originAgentCluster, both of which stay
//   at their defaults) broke SSE live-sync between two simultaneously-open
//   pages (e2e/live-sync.spec.ts's todo case reproduced the failure 100%
//   of the time with COOP on, 0% with it off — confirmed by toggling each
//   helmet sub-policy individually against the real suite). COOP's purpose
//   is isolating browsing contexts from cross-window attacks (Spectre-
//   style); not a meaningful loss for this app's actual threat model, and
//   CORP alone still blocks other origins from loading this app's
//   resources.
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginOpenerPolicy: false,
  }),
);

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
app.use("/api/push", pushRouter);
// ARCHITECTURE.md §9 (M7) — POST /api/voice/transcribe. Behind the same
// requireAuth gate as every other /api/* route (mounted above, §5/§12).
app.use("/api/voice", voiceRouter);

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

// ARCHITECTURE.md §8a — "a plain setInterval inside the already-running
// backend process (every 1–2 minutes)". No cron daemon, no job queue, no
// external scheduler. Runs once immediately on boot (rather than waiting a
// full interval) so a reminder that's due right after a restart doesn't
// wait unnecessarily; errors are caught per-call so one failed scan (a bad
// webpush send, a transient DB hiccup) can't crash the interval or the
// process — see lib/reminders.ts for the scan itself, including the
// VAPID-not-configured no-op escape hatch.
scanAndSendReminders().catch((err) => console.error("[push] reminder scan failed:", err));
setInterval(() => {
  scanAndSendReminders().catch((err) => console.error("[push] reminder scan failed:", err));
}, REMINDER_SCAN_INTERVAL_MS);
