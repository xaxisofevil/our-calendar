import { Router } from "express";
import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "../db/client.js";
import { events } from "../db/schema.js";
import { createEventSchema, updateEventSchema } from "../lib/validation.js";

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
  };
}

// GET /api/events?start=YYYY-MM-DD&end=YYYY-MM-DD
eventsRouter.get("/", (req, res) => {
  const { start, end } = req.query;
  let rows: EventRow[];

  if (typeof start === "string" && typeof end === "string") {
    const startIso = `${start}T00:00:00.000Z`;
    const endIso = `${end}T23:59:59.999Z`;
    rows = db
      .select()
      .from(events)
      .where(and(gte(events.startAt, startIso), lte(events.startAt, endIso)))
      .all();
  } else {
    rows = db.select().from(events).all();
  }

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
      updatedAt: now,
    })
    .run();

  const row = db
    .select()
    .from(events)
    .where(eq(events.id, Number(result.lastInsertRowid)))
    .get();
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
  res.json(serializeEvent(row!));
});

eventsRouter.delete("/:id", (req, res) => {
  const id = Number(req.params.id);
  const existing = db.select().from(events).where(eq(events.id, id)).get();
  if (!existing) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  db.delete(events).where(eq(events.id, id)).run();
  res.status(204).end();
});
