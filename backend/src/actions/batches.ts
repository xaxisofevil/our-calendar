import { randomUUID } from "node:crypto";
import { deleteEvent, listEventsByBatch, type EventDTO } from "./events.js";
import { deleteTodo, listTodosByBatch, type TodoDTO } from "./todos.js";
import { ActionNotFoundError } from "./errors.js";

// Batch-tag-and-undo, generalized out of the calendar-add skill
// (ARCHITECTURE.md §10a-1) into the shared action layer (§10a) so any
// caller — the calendar-add skill itself (still on its own file-manifest
// mechanism, left alone — see the architecture note on why), the upcoming
// §10/M8 voice command layer, or anything built after it — gets the same
// cheap, precise "undo everything this one invocation created" primitive
// without reimplementing it.
//
// Design, and why it differs from calendar-add's original approach:
// calendar-add tags each event's `description` with a `[calendar-add:<id>]`
// string and keeps a side-channel JSON manifest of exactly which event ids
// were created, so undo means "read the manifest, delete those ids". That
// works, but the manifest is a file on disk (nothing to query from SQL, no
// referential integrity, and unaffected by any UI/action-layer change), and
// the description tag is regex/string-matched, not a real column. This
// version instead makes `batch_id` a real, nullable, indexed column on
// `events` and `todos` (see db/client.ts / db/schema.ts) — `undoBatch`
// below just selects "everything with this batch_id" straight from the
// tables that are already the source of truth, no separate manifest file to
// keep in sync or lose. The human-readable trace calendar-add's tag
// provided is kept (see lib/batchTag.ts's `appendBatchTag`, used by
// `createEvent`/`addTodo`) purely as visible provenance in the UI — it is
// never read back to figure out what's in a batch, only the column is.

/**
 * Mints a new batch id. Pass a short human-readable label (e.g.
 * "voice-add-milk", "bills-2026-schedule") to get a readable-but-unique id
 * (handy in logs and the `[batch:<id>]` trace — see lib/batchTag.ts);
 * omit it for a plain random id when there's nothing meaningful to label
 * (e.g. a one-off single-event batch). Always globally unique
 * (`crypto.randomUUID()`) regardless of the label, so two batches created
 * in the same millisecond with the same label — a real possibility for a
 * fast-moving voice layer — never collide the way calendar-add's
 * label+timestamp-only scheme theoretically could.
 */
export function mintBatchId(label?: string): string {
  const id = randomUUID();
  if (!label) return id;
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug ? `${slug}-${id}` : id;
}

export interface BatchContents {
  batchId: string;
  events: EventDTO[];
  todos: TodoDTO[];
}

/**
 * Everything currently tagged with a batch id, across both tables — useful
 * for a caller that wants to show "here's what I'm about to undo" (or
 * already undid) before/after calling `undoBatch`, e.g. a future voice-layer
 * confirmation ("I added 3 events and 1 to-do — undo that?"). Returns empty
 * arrays for an unknown/already-undone batch id, same as `undoBatch` —
 * never throws for "nothing found".
 */
export function getBatch(batchId: string): BatchContents {
  return { batchId, events: listEventsByBatch(batchId), todos: listTodosByBatch(batchId) };
}

export interface UndoBatchResult {
  batchId: string;
  deletedEvents: number;
  deletedTodos: number;
}

/**
 * Deletes every event and todo tagged with `batchId`, via the real
 * `deleteEvent`/`deleteTodo` actions — deliberately not a raw
 * `DELETE FROM ... WHERE batch_id = ?` — so every other side effect those
 * functions already own (the `broadcast("events:changed")` /
 * `broadcast("todos:changed")` SSE calls that keep every other connected
 * device's UI live-synced, per ARCHITECTURE.md §3) fires exactly the same
 * way a manual delete would, once per row. That also means undo is
 * consistent with itself over time for free: if `deleteEvent`/`deleteTodo`
 * ever gain another side effect later (e.g. `sent_reminders` cleanup — see
 * `sent_reminders`'s ON DELETE CASCADE), `undoBatch` inherits it
 * automatically instead of needing a matching update.
 *
 * Graceful on a batch id that doesn't exist or was already undone: both
 * lookups just come back empty, so this returns `{ deletedEvents: 0,
 * deletedTodos: 0 }` rather than throwing — "undo this batch again" or "undo
 * a batch id that was never real" should never be a crash, since a caller
 * (voice, a retried request, a human re-running a command) can't always
 * know in advance whether a given id is still active.
 *
 * Also tolerates a row disappearing between the lookup and the delete (e.g.
 * a household member manually deleted one of the batch's events by hand in
 * the UI moments earlier) — `deleteEvent`/`deleteTodo` throw
 * `ActionNotFoundError` in that case, which is swallowed here for the same
 * "the desired end state already holds" reason `undo-events.mjs` already
 * uses for calendar-add's own undo. Any other error still propagates.
 */
export function undoBatch(batchId: string): UndoBatchResult {
  const { events, todos } = getBatch(batchId);

  let deletedEvents = 0;
  for (const event of events) {
    try {
      deleteEvent(event.id);
      deletedEvents++;
    } catch (err) {
      if (!(err instanceof ActionNotFoundError)) throw err;
    }
  }

  let deletedTodos = 0;
  for (const todo of todos) {
    try {
      deleteTodo(todo.id);
      deletedTodos++;
    } catch (err) {
      if (!(err instanceof ActionNotFoundError)) throw err;
    }
  }

  return { batchId, deletedEvents, deletedTodos };
}
