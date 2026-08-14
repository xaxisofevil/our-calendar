import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Read-only escape hatch into the isolated e2e SQLite file (see
// playwright.config.ts / backend/scripts/reset-and-dev.mjs's
// `DB_DIR_NAME=data-e2e`) — never the real dev/prod database (that lives
// in backend/data/, a different directory name entirely; see
// backend/src/db/client.ts's comment on why the two are never conflated).
//
// Used only by push-notifications.spec.ts to assert on `push_subscriptions`
// / `sent_reminders` rows, since §12's API deliberately exposes no GET
// endpoint for either table (subscribing is meant to be one-directional —
// see ARCHITECTURE.md §8a). Opened read-only: this file mutates the e2e DB
// only through the real HTTP API, same as every other spec, never by
// writing to the file directly.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, "..", "backend", "data-e2e", "our-calendar.sqlite");

export function openE2eDb(): Database.Database {
  return new Database(dbPath, { readonly: true, fileMustExist: true });
}

interface SentReminderRow {
  event_id: number;
  occurrence_start_at: string;
  sent_at: string;
}

/** Polls (rather than a single read) since the reminder scan runs on its
 * own interval (lib/reminders.ts) — the row may not exist yet the instant
 * this is called. Throws if it never shows up within `timeoutMs`. */
export async function waitForSentReminder(
  eventId: number,
  occurrenceStartAt: string,
  timeoutMs = 10_000,
): Promise<SentReminderRow> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const db = openE2eDb();
    let row: SentReminderRow | undefined;
    try {
      row = db
        .prepare("SELECT * FROM sent_reminders WHERE event_id = ? AND occurrence_start_at = ?")
        .get(eventId, occurrenceStartAt) as SentReminderRow | undefined;
    } finally {
      db.close();
    }
    if (row) return row;
    if (Date.now() > deadline) {
      throw new Error(
        `sent_reminders row for event ${eventId} @ ${occurrenceStartAt} never appeared within ${timeoutMs}ms`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

export function countSentReminders(eventId: number, occurrenceStartAt: string): number {
  const db = openE2eDb();
  try {
    const row = db
      .prepare("SELECT COUNT(*) as c FROM sent_reminders WHERE event_id = ? AND occurrence_start_at = ?")
      .get(eventId, occurrenceStartAt) as { c: number };
    return row.c;
  } finally {
    db.close();
  }
}

export function findPushSubscription(endpoint: string): { id: number; endpoint: string } | undefined {
  const db = openE2eDb();
  try {
    return db.prepare("SELECT id, endpoint FROM push_subscriptions WHERE endpoint = ?").get(endpoint) as
      | { id: number; endpoint: string }
      | undefined;
  } finally {
    db.close();
  }
}

export function countPushSubscriptions(endpoint: string): number {
  const db = openE2eDb();
  try {
    const row = db.prepare("SELECT COUNT(*) as c FROM push_subscriptions WHERE endpoint = ?").get(endpoint) as {
      c: number;
    };
    return row.c;
  } finally {
    db.close();
  }
}

