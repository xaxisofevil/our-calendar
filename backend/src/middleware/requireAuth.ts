import type { NextFunction, Request, Response } from "express";
import { findSessionByToken, readCookie, SESSION_COOKIE_NAME } from "../lib/auth.js";

let warnedAuthDisabled = false;

/**
 * Gates every `/api/*` route mounted after it (see index.ts) behind a valid
 * device-session cookie — ARCHITECTURE.md §5/§12. `POST /api/auth/login` and
 * `GET /api/health` are mounted ahead of this middleware specifically so
 * they never hit it (see index.ts's mount order).
 *
 * **Deliberate escape hatch:** if `AUTH_PASSCODE` isn't configured at all,
 * this middleware is a no-op (calls `next()` unconditionally) rather than
 * rejecting every request. Without this, the very first boot after this
 * feature lands — before anyone has set `AUTH_PASSCODE` in a real `.env`
 * (backend/.env.example) — would lock every existing device out with no
 * passcode to type in to get back in. Auth only actually activates once a
 * passcode is configured; that's the intended on-switch, not a bug.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!process.env.AUTH_PASSCODE) {
    if (!warnedAuthDisabled) {
      console.warn(
        "[auth] AUTH_PASSCODE is not set — /api/* routes are NOT protected. Set AUTH_PASSCODE (see backend/.env.example) to enable the passcode gate.",
      );
      warnedAuthDisabled = true;
    }
    next();
    return;
  }

  const token = readCookie(req.headers.cookie, SESSION_COOKIE_NAME);
  const session = token ? findSessionByToken(token) : null;
  if (!session) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  next();
}
