import { and, eq, gte, isNotNull, isNull, lte } from "drizzle-orm";
import { db } from "../db/client.js";
import { events } from "../db/schema.js";
import { createEventSchema, updateEventSchema } from "../lib/validation.js";
import { expandOccurrences } from "../lib/recurrence.js";
import { broadcast } from "../lib/sse.js";
import { ActionNotFoundError, ActionValidationError } from "./errors.js";

// Shared action layer (ARCHITECTURE.md §10a) — the one home for event CRUD
// logic. Both `routes/events.ts` (REST) and `mcp/server.ts` (MCP tools) call
// straight into these functions instead of each having their own copy of
// this logic. Behavior (including recurrence expansion, §7a) is unchanged
// from the pre-extraction inline route handlers.

type EventRow = typeof events.$inferSelect;

export interface EventDTO {
  id: number;
  personId: number | null;
  title: string;
  description: string | null;
  location: string | null;
  startAt: string;
  endAt: string;
  allDay: boolean;
  recurrenceRule: string | null;
}

function serializeEvent(row: EventRow): EventDTO {
  return {
    id: row.id,
    personId: row.personId,
    title: row.title,
    description: row.description,
    location: row.location,
    startAt: row.startAt,
    endAt: row.endAt,
    allDay: Boolean(row.allDay),
    recurrenceRule: row.recurrenceRule ?? null,
  };
}

export interface ListEventsRange {
  start: string;
  end: string;
}

/**
 * Mirrors the pre-extraction `GET /api/events` handler exactly, including
 * its comment block's reasoning (kept there — see routes/events.ts):
 * recurring master rows are expanded into occurrences at read time (§7a) via
 * lib/recurrence.ts; non-recurring rows pass straight through. Omitting
 * `range` returns unexpanded master rows, same as the original "no range
 * given" branch.
 */
export function listEvents(range?: ListEventsRange): EventDTO[] {
  if (!range) {
    const rows = db.select().from(events).all();
    return rows.map(serializeEvent);
  }

  const rangeStart = new Date(`${range.start}T00:00:00.000Z`);
  const rangeEnd = new Date(`${range.end}T23:59:59.999Z`);
  const startIso = rangeStart.toISOString();
  const endIso = rangeEnd.toISOString();

  const singleRows = db
    .select()
    .from(events)
    .where(and(isNull(events.recurrenceRule), gte(events.startAt, startIso), lte(events.startAt, endIso)))
    .all();

  const recurringRows = db
    .select()
    .from(events)
    .where(and(isNotNull(events.recurrenceRule), lte(events.startAt, endIso)))
    .all();

  const expanded = recurringRows.flatMap((row) => {
    const dtstart = new Date(row.startAt);
    const durationMs = new Date(row.endAt).getTime() - dtstart.getTime();
    const occurrences = expandOccurrences(row.recurrenceRule!, dtstart, durationMs, rangeStart, rangeEnd);
    return occurrences.map(({ start: occStart, end: occEnd }) =>
      serializeEvent({ ...row, startAt: occStart.toISOString(), endAt: occEnd.toISOString() }),
    );
  });

  return [...singleRows.map(serializeEvent), ...expanded].sort((a, b) => a.startAt.localeCompare(b.startAt));
}

/** Validates with `createEventSchema` and throws `ActionValidationError` on failure. */
export function createEvent(input: unknown): EventDTO {
  const parsed = createEventSchema.safeParse(input);
  if (!parsed.success) throw new ActionValidationError(parsed.error);

  const now = new Date().toISOString();
  const result = db
    .insert(events)
    .values({
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      location: parsed.data.location ?? null,
      startAt: parsed.data.startAt,
      endAt: parsed.data.endAt,
      allDay: parsed.data.allDay,
      personId: parsed.data.personId ?? null,
      recurrenceRule: parsed.data.recurrenceRule ?? null,
      updatedAt: now,
    })
    .run();

  const row = db
    .select()
    .from(events)
    .where(eq(events.id, Number(result.lastInsertRowid)))
    .get();
  broadcast("events:changed");
  return serializeEvent(row!);
}

/**
 * Validates with `updateEventSchema` (a `.partial()` of create). Edits the
 * whole series for a recurring event — no per-occurrence exceptions, per
 * §7a's explicit v1 scope limit. Throws `ActionNotFoundError` if `id`
 * doesn't exist, `ActionValidationError` on bad input.
 */
export function updateEvent(id: number, input: unknown): EventDTO {
  const parsed = updateEventSchema.safeParse(input);
  if (!parsed.success) throw new ActionValidationError(parsed.error);

  const existing = db.select().from(events).where(eq(events.id, id)).get();
  if (!existing) throw new ActionNotFoundError("Event not found");

  const now = new Date().toISOString();
  db.update(events)
    .set({ ...parsed.data, updatedAt: now })
    .where(eq(events.id, id))
    .run();
  const row = db.select().from(events).where(eq(events.id, id)).get();
  broadcast("events:changed");
  return serializeEvent(row!);
}

/**
 * Deletes the whole master row — for a recurring event that's the entire
 * series (§7a). Throws `ActionNotFoundError` if `id` doesn't exist.
 */
export function deleteEvent(id: number): void {
  const existing = db.select().from(events).where(eq(events.id, id)).get();
  if (!existing) throw new ActionNotFoundError("Event not found");
  db.delete(events).where(eq(events.id, id)).run();
  broadcast("events:changed");
}
