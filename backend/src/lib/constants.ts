// ARCHITECTURE.md §8a — push-notification constants, fixed in code, not
// configurable (no per-event/per-person settings — see §8a's opening
// paragraph for why).

/**
 * "Any event — any person — starting within `NOTIFICATION_LEAD_MINUTES`
 * (defaulting to 30) fires one push" (§8a). This is the one real definition
 * of that constant. `frontend/src/lib/imminent.ts` intentionally duplicates
 * the same number for its own §8b "imminent" pulse — the frontend and
 * backend are separate npm packages with no shared module between them, so
 * there's nothing to literally import; keep both in sync by hand if this
 * value ever changes (frontend/src/lib/imminent.ts's comment points back
 * here for the same reason).
 */
export const NOTIFICATION_LEAD_MINUTES = 30;

/**
 * How often the in-process reminder scan runs (§8a: "a plain setInterval
 * inside the already-running backend process (every 1–2 minutes)"). 90s
 * sits in the middle of that range. Overridable via env var so the isolated
 * e2e harness (see playwright.config.ts) can run it fast enough to assert
 * against within a normal test timeout, without changing production/dev
 * behavior — same pattern as PORT/AUTH_PASSCODE already use for the same
 * reason.
 */
export const REMINDER_SCAN_INTERVAL_MS = process.env.REMINDER_SCAN_INTERVAL_MS
  ? Number(process.env.REMINDER_SCAN_INTERVAL_MS)
  : 90_000;
