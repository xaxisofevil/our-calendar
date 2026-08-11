import { sqliteTable, integer, text } from "drizzle-orm/sqlite-core";

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
  updatedAt: text("updated_at").notNull(),
});
