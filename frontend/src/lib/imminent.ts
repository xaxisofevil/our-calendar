import { useEffect, useMemo, useState } from "react";
import type { EventRecord } from "../types";

/**
 * ARCHITECTURE.md §8b: "imminent" reuses §8a's exact lead-time constant
 * (`NOTIFICATION_LEAD_MINUTES`, default 30) — one concept, two surfaces
 * (this pulse + the real push notification), not a second magic number to
 * keep in sync.
 *
 * M5 (§14) landed the real push-notification backend, whose own copy of
 * this constant lives at `backend/src/lib/constants.ts`. That's the one
 * real *definition*; this one is an intentional duplicate, not a stale
 * placeholder — the frontend and backend are separate npm packages with no
 * shared module between them, so there's nothing to literally import
 * across that boundary. If this value ever changes, update both files by
 * hand (backend's constants.ts comment points back here for the same
 * reason).
 */
export const NOTIFICATION_LEAD_MINUTES = 30;

/** How often the client-side timer recomputes which events are imminent.
 * ARCHITECTURE.md §8b: "every 30-60s, not every frame" — cheap enough to
 * leave running indefinitely on an older Android tablet. */
const IMMINENT_RECHECK_INTERVAL_MS = 30_000;

/**
 * True if `startAt` is starting soon but hasn't started yet:
 * `now <= startAt < now + leadMinutes`. An event whose start has already
 * passed is "happening", not "imminent" (§8b) — this flips back to false
 * on its own as `now` advances, no separate "clear" step needed.
 */
export function isImminent(startAt: string, now: Date, leadMinutes: number = NOTIFICATION_LEAD_MINUTES): boolean {
  const startMs = new Date(startAt).getTime();
  const nowMs = now.getTime();
  return nowMs <= startMs && startMs < nowMs + leadMinutes * 60_000;
}

/**
 * Identifies one *occurrence* of an event, not just the event row. Recurring
 * events (§7a) are expanded at read time without materialized occurrence
 * rows, so every occurrence of the same master event shares the same `id`
 * but has a distinct `startAt` — keying only on `id` would make one
 * occurrence's imminent-ness bleed onto every other occurrence of the same
 * series rendered elsewhere (a different day in the same visible month).
 */
export function eventImminentKey(event: Pick<EventRecord, "id" | "startAt">): string {
  return `${event.id}|${event.startAt}`;
}

/**
 * Recomputes, on a lightweight interval (not per-frame — ARCHITECTURE.md
 * §8b), which of the given (currently-loaded) events are presently
 * "imminent". Returns a Set of `eventImminentKey()` values for O(1) lookup
 * by the two consuming surfaces (MonthGrid's dot, DayDetailPanel's row).
 * The actual pulse animation is pure CSS on a class toggled from this set —
 * this hook only ever does cheap Date math, no DOM/layout work.
 */
export function useImminentEventKeys(events: EventRecord[]): Set<string> {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), IMMINENT_RECHECK_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  return useMemo(() => {
    const keys = new Set<string>();
    for (const event of events) {
      if (isImminent(event.startAt, now)) keys.add(eventImminentKey(event));
    }
    return keys;
  }, [events, now]);
}
