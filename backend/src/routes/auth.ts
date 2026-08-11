import { Router } from "express";
import {
  createDeviceSession,
  deleteSessionByToken,
  readCookie,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_MS,
  verifyPasscode,
} from "../lib/auth.js";
import { requireAuth } from "../middleware/requireAuth.js";

export const authRouter = Router();

// ARCHITECTURE.md §5: HttpOnly + Secure + SameSite=Lax, ~1 year. `secure:
// true` requires https — Chromium (and this suite's Playwright runs) treats
// `http://localhost` as a secure context for this purpose too, same as the
// service-worker registration ARCHITECTURE.md §4 already relies on
// localhost-as-secure-origin for; a real deployment is behind Caddy's TLS
// termination regardless (§6, out of this task's scope).
function setSessionCookie(res: import("express").Response, token: string): void {
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE_MS,
    path: "/",
  });
}

// Mounted ahead of the app-wide `requireAuth` (see index.ts) — this is the
// one other unauthenticated /api/* route besides GET /api/health (§12).
authRouter.post("/login", (req, res) => {
  const passcode = typeof req.body?.passcode === "string" ? req.body.passcode : "";
  if (!verifyPasscode(passcode)) {
    // §5: no information leakage about *why* — same response whether the
    // passcode was wrong, blank, malformed, or AUTH_PASSCODE isn't
    // configured server-side at all.
    res.status(401).json({ error: "Invalid passcode" });
    return;
  }
  const deviceLabel = typeof req.body?.deviceLabel === "string" ? req.body.deviceLabel.slice(0, 200) : null;
  const { token } = createDeviceSession(deviceLabel);
  setSessionCookie(res, token);
  res.status(200).json({ ok: true });
});

// Cheap, side-effect-free check the frontend calls once on load to decide
// whether to show the passcode screen or the real app (lib/auth.ts on the
// frontend) — gated by requireAuth itself, so "200" IS the authenticated
// signal; no separate body shape to keep in sync with requireAuth's own
// notion of "valid session."
authRouter.get("/session", requireAuth, (_req, res) => {
  res.json({ ok: true });
});

// Not explicitly in ARCHITECTURE.md's API table (§12), but a small, sensible
// addition for completeness — also gated by requireAuth (mounted per-route
// here since this whole router is mounted *ahead of* the app-wide
// requireAuth in index.ts, precisely so /login above can stay exempt).
authRouter.post("/logout", requireAuth, (req, res) => {
  const token = readCookie(req.headers.cookie, SESSION_COOKIE_NAME);
  if (token) deleteSessionByToken(token);
  res.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
  res.status(200).json({ ok: true });
});
