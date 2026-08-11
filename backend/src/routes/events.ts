import { Router } from "express";
import { ActionNotFoundError, ActionValidationError, createEvent, deleteEvent, listEvents, updateEvent } from "../actions/index.js";

export const eventsRouter = Router();

// GET /api/events?start=YYYY-MM-DD&end=YYYY-MM-DD
//
// Recurring events (recurrence_rule set) are stored as a single "master"
// row and never materialized as occurrence rows (ARCHITECTURE.md §7a). When
// a date range is requested, every candidate master (its own start_at is on
// or before the end of the range — it could still be recurring from long
// before the range started) gets expanded, and each occurrence is
// serialized as its own event instance with the master's id (edit/delete
// always target the whole series, per §7a's explicit v1 scope limit) and
// that occurrence's own start/end. The frontend never has to know or care
// whether a given instance it renders is a one-off row or an expanded
// occurrence. Expansion logic itself lives in actions/events.ts, the one
// home shared with the MCP server (§10a).
eventsRouter.get("/", (req, res) => {
  const { start, end } = req.query;

  if (typeof start === "string" && typeof end === "string") {
    res.json(listEvents({ start, end }));
    return;
  }

  // No range given: return master rows as-is, unexpanded — there's no
  // sensible bounded window to expand an open-ended recurrence into.
  // Nothing in the frontend calls GET /api/events without start/end today.
  res.json(listEvents());
});

eventsRouter.post("/", (req, res) => {
  try {
    const event = createEvent(req.body);
    res.status(201).json(event);
  } catch (err) {
    if (err instanceof ActionValidationError) {
      res.status(400).json({ error: err.issues });
      return;
    }
    throw err;
  }
});

eventsRouter.patch("/:id", (req, res) => {
  const id = Number(req.params.id);
  try {
    const event = updateEvent(id, req.body);
    res.json(event);
  } catch (err) {
    if (err instanceof ActionValidationError) {
      res.status(400).json({ error: err.issues });
      return;
    }
    if (err instanceof ActionNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    throw err;
  }
});

// Deletes the whole master row — for a recurring event that means the
// entire series, per §7a's explicit v1 scope limit (no per-occurrence
// exceptions yet).
eventsRouter.delete("/:id", (req, res) => {
  const id = Number(req.params.id);
  try {
    deleteEvent(id);
    res.status(204).end();
  } catch (err) {
    if (err instanceof ActionNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    throw err;
  }
});
