import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { deviceSessions } from "../db/schema.js";

// Device-session passcode auth (ARCHITECTURE.md §5/§11/§12, M5/M6). One
// home for the hashing/session logic, shared by routes/auth.ts (login/
// logout) and middleware/requireAuth.ts (the per-request gate) — same
// "shared module, not scattered across handlers" reasoning as the actions/
// layer (§10a), even though this isn't itself an MCP-exposed action.

export const SESSION_COOKIE_NAME = "our_calendar_session";

// "~1 year" per §5's "long-lived device session" design.
export const SESSION_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

// Throttle for bumping `last_seen_at` — every *valid* request re-hashes and
// looks up the session anyway (that's the auth check itself), but we don't
// need a write on every single GET just to keep that timestamp fresh; once
// per window is plenty for "device_label"/"last_seen_at" to stay useful for
// a human skimming the table later.
const LAST_SEEN_TOUCH_INTERVAL_MS = 5 * 60_000;

function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/** Hash of the raw cookie token — this, never the token itself, is what's
 * stored in `device_sessions.token_hash` (§5: "the session-passcode hash is
 * hashed at rest"). */
export function hashSessionToken(token: string): string {
  return sha256Hex(token);
}

// Passcode verification. AUTH_PASSCODE (backend/.env.example) is the only
// place the real passcode ever lives in plaintext, and even that is only
// ever read into memory, then immediately hashed (scrypt, Node's built-in
// crypto — no bcrypt/argon2 dependency needed for a single shared household
// secret compared against occasionally, not a real user-password store) with
// a random per-boot salt before any comparison happens. Cached lazily so the
// expensive scrypt hash only runs once per process, not once per login
// attempt.
let cachedPasscodeHash: { salt: Buffer; hash: Buffer } | null = null;
let warnedMissingPasscode = false;

function getPasscodeHash(): { salt: Buffer; hash: Buffer } | null {
  const configured = process.env.AUTH_PASSCODE;
  if (!configured) {
    if (!warnedMissingPasscode) {
      // Logged once, not per-request — see requireAuth's own comment for
      // what an unset AUTH_PASSCODE means for enforcement.
      console.warn("[auth] AUTH_PASSCODE is not set — POST /api/auth/login will reject every attempt. See backend/.env.example.");
      warnedMissingPasscode = true;
    }
    return null;
  }
  if (!cachedPasscodeHash) {
    const salt = crypto.randomBytes(16);
    const hash = crypto.scryptSync(configured, salt, 64);
    cachedPasscodeHash = { salt, hash };
  }
  return cachedPasscodeHash;
}

/**
 * Constant-time check against AUTH_PASSCODE. Returns false (never throws)
 * for a wrong passcode, a missing/empty candidate, or AUTH_PASSCODE not
 * being configured at all — routes/auth.ts's login handler responds with
 * the same generic 401 in every case, per §5's "no information leakage
 * about why."
 */
export function verifyPasscode(candidate: string): boolean {
  const configured = getPasscodeHash();
  if (!configured || !candidate) return false;
  const candidateHash = crypto.scryptSync(candidate, configured.salt, 64);
  return crypto.timingSafeEqual(candidateHash, configured.hash);
}

export interface DeviceSessionRow {
  id: number;
  tokenHash: string;
  deviceLabel: string | null;
  createdAt: string;
  lastSeenAt: string;
}

/** Creates a new device session row and returns the raw token to set as the
 * cookie value — the raw token is never persisted, only its hash. */
export function createDeviceSession(deviceLabel: string | null = null): { token: string; session: DeviceSessionRow } {
  const token = generateSessionToken();
  const tokenHash = hashSessionToken(token);
  const now = new Date().toISOString();
  const result = db
    .insert(deviceSessions)
    .values({ tokenHash, deviceLabel, createdAt: now, lastSeenAt: now })
    .run();
  const session = db
    .select()
    .from(deviceSessions)
    .where(eq(deviceSessions.id, Number(result.lastInsertRowid)))
    .get()!;
  return { token, session };
}

/**
 * Looks up the session for a raw cookie token (hashing it first — the DB
 * never sees/stores the raw value). Returns null for a missing/invalid
 * token, or a valid-looking token whose session has outlived
 * SESSION_MAX_AGE_MS (checked server-side, not just left to the cookie's own
 * `maxAge` — a client could in principle keep sending an old cookie past
 * its expiry, so this is the actual enforcement point). An expired session
 * row is deleted on the way out rather than left to accumulate.
 */
export function findSessionByToken(token: string): DeviceSessionRow | null {
  const tokenHash = hashSessionToken(token);
  const row = db.select().from(deviceSessions).where(eq(deviceSessions.tokenHash, tokenHash)).get();
  if (!row) return null;

  const ageMs = Date.now() - new Date(row.createdAt).getTime();
  if (ageMs > SESSION_MAX_AGE_MS) {
    db.delete(deviceSessions).where(eq(deviceSessions.id, row.id)).run();
    return null;
  }

  if (Date.now() - new Date(row.lastSeenAt).getTime() > LAST_SEEN_TOUCH_INTERVAL_MS) {
    const now = new Date().toISOString();
    db.update(deviceSessions).set({ lastSeenAt: now }).where(eq(deviceSessions.id, row.id)).run();
  }

  return row;
}

export function deleteSessionByToken(token: string): void {
  const tokenHash = hashSessionToken(token);
  db.delete(deviceSessions).where(eq(deviceSessions.tokenHash, tokenHash)).run();
}

/** Hand-rolled — no `cookie-parser` dependency for reading a single cookie
 * by name (Express's own `res.cookie()` already covers writing, via a
 * `cookie` package it depends on internally). */
export function readCookie(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (key === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}
