import { sqliteTable, integer, text, primaryKey } from "drizzle-orm/sqlite-core";

/**
 * Dateless, shared household to-do list.
 * Matches ARCHITECTURE.md §11, extended with a nullable `notes` column
 * (added post-M1-kickoff per coordinator request — free text, optional).
 */
export const todos = sqliteTable("todos", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  text: text("text").notNull(),
  notes: text("notes"),
  // Optional ISO 8601 date (YYYY-MM-DD); ARCHITECTURE.md §8/§11 — an
  // attribute on the flat dateless list, not a second calendar.
  dueAt: text("due_at"),
  completed: integer("completed", { mode: "boolean" }).notNull().default(false),
  list: text("list").notNull().default("household"),
  position: integer("position").notNull(),
  // Nullable batch-tag id (backend/src/actions/batches.ts, generalized out
  // of the calendar-add skill — see ARCHITECTURE.md §10a-1's "generalizing"
  // note and the new batch-undo subsection). NULL for anything created the
  // normal way (the REST UI never sets this); set only by callers that mint
  // a batch id up front (calendar-add, and eventually §10's voice layer) so
  // everything created in one invocation can be found and undone precisely
  // via `undoBatch`, without parsing free text back out of `notes`.
  batchId: text("batch_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/**
 * A household member — deliberately decoupled from Google OAuth. "Who this
 * is" and "whether their Google Calendar happens to be connected yet" are
 * separate concerns; a person exists (and can own/color events) whether or
 * not `google_accounts` (M3, not built yet) has a row for them.
 */
export const people = sqliteTable("people", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  label: text("label").notNull(),
  color: text("color").notNull(),
});

/**
 * Local read cache of calendar events. Matches ARCHITECTURE.md §11 with one
 * deliberate M1 deviation: `google_account_id` / `google_event_id` are
 * nullable here (the doc's schema assumes M3 Google integration exists;
 * for M1 every row is hand-entered / locally created and has neither).
 * The UNIQUE(google_account_id, google_event_id) constraint from the doc is
 * deferred to M3 for the same reason — see report-back notes.
 */
export const events = sqliteTable("events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  personId: integer("person_id"),
  googleAccountId: integer("google_account_id"),
  googleEventId: text("google_event_id"),
  title: text("title").notNull(),
  description: text("description"),
  location: text("location"),
  startAt: text("start_at").notNull(),
  endAt: text("end_at").notNull(),
  allDay: integer("all_day", { mode: "boolean" }).notNull().default(false),
  // RFC 5545 RRULE string (e.g. "FREQ=WEEKLY;BYDAY=TH"), NULL for
  // non-recurring events — see ARCHITECTURE.md §7a/§11. This row is always
  // the "master" event; occurrences are computed at read time, never
  // materialized as rows (see routes/events.ts GET handler).
  recurrenceRule: text("recurrence_rule"),
  // See todos.batchId's comment above — same mechanism, same reasoning,
  // shared by both tables so a single batch id can span events and todos
  // created in one invocation (e.g. "add the game to the calendar and put
  // tickets on the to-do list").
  batchId: text("batch_id"),
  updatedAt: text("updated_at").notNull(),
});

/**
 * Long-lived device sessions backing the passcode auth gate
 * (ARCHITECTURE.md §5/§11/§12, M5/M6). One row per device that's completed
 * the passcode flow; `token_hash` is a hash of the random token handed to
 * the browser as an HttpOnly cookie — the raw token itself is never stored,
 * only ever compared by re-hashing an incoming cookie value (see
 * lib/auth.ts). `device_label` is optional/best-effort, same spirit as
 * `push_subscriptions.device_label`.
 */
export const deviceSessions = sqliteTable("device_sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tokenHash: text("token_hash").notNull().unique(),
  deviceLabel: text("device_label"),
  createdAt: text("created_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
});

/**
 * §8a/§11 — one row per opted-in device's Web Push subscription, not scoped
 * to a particular person. `endpoint` is unique because a browser's push
 * endpoint uniquely identifies the subscription; re-subscribing the same
 * device (e.g. after clearing storage) upserts on that column rather than
 * accumulating duplicate rows (see actions/push.ts).
 */
export const pushSubscriptions = sqliteTable("push_subscriptions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  deviceLabel: text("device_label"),
  createdAt: text("created_at").notNull(),
});

/**
 * §8a/§11 — dedup log so a recurring event's Nth occurrence only ever
 * notifies once, without needing occurrences to exist as real rows anywhere
 * (§7a). Composite primary key on (event_id, occurrence_start_at) — the
 * same pair the reminder scanner (lib/reminders.ts) checks before sending.
 */
export const sentReminders = sqliteTable(
  "sent_reminders",
  {
    eventId: integer("event_id").notNull(),
    occurrenceStartAt: text("occurrence_start_at").notNull(),
    sentAt: text("sent_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.eventId, table.occurrenceStartAt] })],
);
