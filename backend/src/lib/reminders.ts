import { and, eq } from "drizzle-orm";
import webpush from "web-push";
import { db } from "../db/client.js";
import { pushSubscriptions, sentReminders } from "../db/schema.js";
import { listEventsBetween } from "../actions/events.js";
import { listPeople } from "../actions/people.js";
import { NOTIFICATION_LEAD_MINUTES } from "./constants.js";

/**
 * ARCHITECTURE.md §8a — the in-process reminder scan. Wired into a plain
 * `setInterval` in index.ts (no cron daemon, no job queue). Every call is a
 * fresh, idempotent pass: nothing here holds state across calls except
 * what's durably recorded in `sent_reminders`, so a missed tick, a slow
 * tick, or a process restart can't double-send or permanently drop an
 * occurrence — the next tick just re-scans the same window and skips
 * whatever's already recorded.
 */

let vapidReady = false;
let warnedVapidMissing = false;

/**
 * Mirrors `middleware/requireAuth.ts`'s "escape hatch" pattern (§5): if
 * `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` aren't configured (e.g. a fresh
 * checkout before an operator has set real values in `backend/.env` — see
 * `.env.example`), reminders are silently a no-op instead of crashing the
 * process on every tick. Push only actually activates once both keys are
 * configured; that's the intended on-switch, not a bug.
 */
function ensureVapid(): boolean {
  if (vapidReady) return true;
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    if (!warnedVapidMissing) {
      console.warn(
        "[push] VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY not set — push reminders are disabled. See backend/.env.example.",
      );
      warnedVapidMissing = true;
    }
    return false;
  }
  // The VAPID "subject" is a contact URI push services may use to reach the
  // sender about a misbehaving application server — not household data, but
  // still not hardcoded to a real address in source; falls back to a
  // generic placeholder if VAPID_SUBJECT isn't set.
  webpush.setVapidDetails(VAPID_SUBJECT || "mailto:admin@example.invalid", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  vapidReady = true;
  return true;
}

function formatOccurrenceTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/**
 * §8a's fixed message content — revised after real-device testing: the
 * event itself should be the headline (Android/iOS render the OS-level
 * notification `title` in bold, most-prominent text), with the app name
 * showing separately via the OS's own small-icon/origin chrome — putting
 * "Our Calendar" in the title field was wasted, most-prominent space on
 * something the person already knows just by looking at the icon. `title`
 * is now the event's own title; `body` carries only the time/person detail.
 */
function buildReminderTitle(title: string): string {
  return title;
}

function buildReminderBody(startAt: string, personLabel: string): string {
  return `${formatOccurrenceTime(startAt)} · ${personLabel}`;
}

/**
 * One scan pass: find every occurrence starting within
 * `NOTIFICATION_LEAD_MINUTES`, skip anything already in `sent_reminders`,
 * push the rest to every subscribed device, and record each as sent.
 * Exported (not just wired into the interval) so it can be awaited directly
 * — both `index.ts`'s interval and tests call it the same way.
 */
export async function scanAndSendReminders(): Promise<void> {
  if (!ensureVapid()) return;

  const now = new Date();
  const windowEnd = new Date(now.getTime() + NOTIFICATION_LEAD_MINUTES * 60_000);

  // Reuses actions/events.ts's listEventsBetween, itself built on
  // lib/recurrence.ts's read-time RRULE expansion (§7a) — no separate
  // recurrence math lives here.
  const occurrences = listEventsBetween(now, windowEnd);
  if (occurrences.length === 0) return;

  const subscriptions = db.select().from(pushSubscriptions).all();
  if (subscriptions.length === 0) return;

  const peopleById = new Map(listPeople().map((p) => [p.id, p.label] as const));

  for (const occurrence of occurrences) {
    const alreadySent = db
      .select()
      .from(sentReminders)
      .where(
        and(eq(sentReminders.eventId, occurrence.id), eq(sentReminders.occurrenceStartAt, occurrence.startAt)),
      )
      .get();
    if (alreadySent) continue;

    const personLabel = occurrence.personId != null ? (peopleById.get(occurrence.personId) ?? "Someone") : "Someone";
    // `title` is the event itself (the OS's most-prominent notification
    // text); `body` is the time/person detail. `eventId`/`occurrenceStartAt`
    // give the service worker's `push` handler (frontend/src/sw.ts) enough
    // to show a real OS notification without it needing to know the
    // message format itself.
    const payload = JSON.stringify({
      title: buildReminderTitle(occurrence.title),
      body: buildReminderBody(occurrence.startAt, personLabel),
      eventId: occurrence.id,
      occurrenceStartAt: occurrence.startAt,
    });

    for (const subscription of subscriptions) {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          payload,
        );
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          // Push service says this subscription is gone (uninstalled,
          // expired) — clean it up rather than retrying it forever.
          db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, subscription.id)).run();
        } else {
          console.error(`[push] send failed for subscription ${subscription.id}:`, err);
        }
      }
    }

    // Recorded once per occurrence regardless of individual delivery
    // failures above — sent_reminders dedups per *occurrence*, not per
    // subscriber (§8a), so one dead endpoint shouldn't make an occurrence
    // retry forever on every future tick.
    db.insert(sentReminders)
      .values({ eventId: occurrence.id, occurrenceStartAt: occurrence.startAt, sentAt: new Date().toISOString() })
      .run();
  }
}
