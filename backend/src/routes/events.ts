import { Router } from "express";
import { and, eq, gte, isNotNull, isNull, lte } from "drizzle-orm";
import { db } from "../db/client.js";
import { events } from "../db/schema.js";
import { createEventSchema, updateEventSchema } from "../lib/validation.js";
import { expandOccurrences } from "../lib/recurrence.js";
import { broadcast } from "../lib/sse.js";

export const eventsRouter = Router();

type EventRow = typeof events.$inferSelect;

function serializeEvent(row: EventRow) {
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

// GET /api/events?start=YYYY-MM-DD&end=YYYY-MM-DD
//
// Recurring events (recurrence_rule set) are stored as a single "master"
// row and never materialized as occurrence rows (ARCHITECTURE.md §7a). When
// a date range is requested, every candidate master (its own start_at is on
// or before the end of the range — it could still be recurring from long
// before the range started) gets expanded via lib/recurrence.ts, and each
// occurrence is serialized as its own event instance with the master's id
// (edit/delete always target the whole series, per §7a's explicit v1 scope
// limit) and that occurrence's own start/end. The frontend never has to
// know or care whether a given instance it renders is a one-off row or an
// expanded occurrence.
eventsRouter.get("/", (req, res) => {
  const { start, end } = req.query;

  if (typeof start === "string" && typeof end === "string") {
    const rangeStart = new Date(`${start}T00:00:00.000Z`);
    const rangeEnd = new Date(`${end}T23:59:59.999Z`);
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

    const result = [...singleRows.map(serializeEvent), ...expanded].sort((a, b) => a.startAt.localeCompare(b.startAt));
    res.json(result);
    return;
  }

  // No range given: return master rows as-is, unexpanded — there's no
  // sensible bounded window to expand an open-ended recurrence into.
  // Nothing in the frontend calls GET /api/events without start/end today.
  const rows = db.select().from(events).all();
  res.json(rows.map(serializeEvent));
});

eventsRouter.post("/", (req, res) => {
  const parsed = createEventSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
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
  res.status(201).json(serializeEvent(row!));
});

eventsRouter.patch("/:id", (req, res) => {
  const id = Number(req.params.id);
  const parsed = updateEventSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const existing = db.select().from(events).where(eq(events.id, id)).get();
  if (!existing) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  const now = new Date().toISOString();
  db.update(events)
    .set({ ...parsed.data, updatedAt: now })
    .where(eq(events.id, id))
    .run();
  const row = db.select().from(events).where(eq(events.id, id)).get();
  broadcast("events:changed");
  res.json(serializeEvent(row!));
});

// Deletes the whole master row — for a recurring event that means the
// entire series, per §7a's explicit v1 scope limit (no per-occurrence
// exceptions yet).
eventsRouter.delete("/:id", (req, res) => {
  const id = Number(req.params.id);
  const existing = db.select().from(events).where(eq(events.id, id)).get();
  if (!existing) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  db.delete(events).where(eq(events.id, id)).run();
  broadcast("events:changed");
  res.status(204).end();
});
