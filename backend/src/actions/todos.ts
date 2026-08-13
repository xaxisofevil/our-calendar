import { eq } from "drizzle-orm";
import { db, sqlite } from "../db/client.js";
import { todos } from "../db/schema.js";
import { createTodoSchema, updateTodoSchema } from "../lib/validation.js";
import { broadcast } from "../lib/sse.js";
import { appendBatchTag } from "../lib/batchTag.js";
import { ActionNotFoundError, ActionValidationError } from "./errors.js";

// Shared action layer (ARCHITECTURE.md §10a) — the one home for todo CRUD
// logic, called by both `routes/todos.ts` (REST) and `mcp/server.ts` (MCP
// tools).

type TodoRow = typeof todos.$inferSelect;

export interface TodoDTO {
  id: number;
  text: string;
  notes: string | null;
  dueAt: string | null;
  completed: boolean;
  list: string;
  position: number;
  // See ARCHITECTURE.md's batch-undo subsection / actions/batches.ts. NULL
  // for anything created the normal way (REST/MCP callers never set this).
  batchId: string | null;
}

function serializeTodo(row: TodoRow): TodoDTO {
  return {
    id: row.id,
    text: row.text,
    notes: row.notes,
    dueAt: row.dueAt,
    completed: Boolean(row.completed),
    list: row.list,
    position: row.position,
    batchId: row.batchId ?? null,
  };
}

export function listTodos(): TodoDTO[] {
  const rows = db.select().from(todos).orderBy(todos.position).all();
  return rows.map(serializeTodo);
}

/**
 * Validates with `createTodoSchema` and throws `ActionValidationError` on
 * failure. `batchId` is a separate parameter, not part of the validated
 * input — same reasoning as `createEvent`'s `batchId` param (see its own
 * comment): a trusted value minted by the caller via `actions/batches.ts`,
 * never something a REST body should set directly.
 */
export function addTodo(input: unknown, batchId?: string | null): TodoDTO {
  const parsed = createTodoSchema.safeParse(input);
  if (!parsed.success) throw new ActionValidationError(parsed.error);

  const now = new Date().toISOString();
  const maxRow = sqlite.prepare("select max(position) as m from todos").get() as { m: number | null };
  const nextPosition = (maxRow.m ?? -1) + 1;

  const result = db
    .insert(todos)
    .values({
      text: parsed.data.text,
      notes: appendBatchTag(parsed.data.notes ?? null, batchId),
      dueAt: parsed.data.dueAt ?? null,
      list: parsed.data.list ?? "household",
      completed: false,
      position: nextPosition,
      batchId: batchId ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  const row = db
    .select()
    .from(todos)
    .where(eq(todos.id, Number(result.lastInsertRowid)))
    .get();
  broadcast("todos:changed");
  return serializeTodo(row!);
}

/**
 * Generic partial update (toggle complete / edit text / notes / due date /
 * reorder — the full PATCH surface). Validates with `updateTodoSchema`.
 * Throws `ActionNotFoundError` if `id` doesn't exist.
 */
export function updateTodo(id: number, input: unknown): TodoDTO {
  const parsed = updateTodoSchema.safeParse(input);
  if (!parsed.success) throw new ActionValidationError(parsed.error);

  const existing = db.select().from(todos).where(eq(todos.id, id)).get();
  if (!existing) throw new ActionNotFoundError("Todo not found");

  const now = new Date().toISOString();
  db.update(todos)
    .set({ ...parsed.data, updatedAt: now })
    .where(eq(todos.id, id))
    .run();
  const row = db.select().from(todos).where(eq(todos.id, id)).get();
  broadcast("todos:changed");
  return serializeTodo(row!);
}

/**
 * Convenience wrapper over `updateTodo` for the common "mark done" case —
 * mainly useful as its own MCP tool (§10a lists `complete_todo` as a named
 * action) so a caller doesn't need to know the generic PATCH shape just to
 * check something off. Not used by the REST route, which already exposes
 * the generic partial update via `updateTodo`.
 */
export function completeTodo(id: number): TodoDTO {
  return updateTodo(id, { completed: true });
}

/**
 * Every todo tagged with a given batch id — `actions/batches.ts`'s
 * `undoBatch` uses this, same "one home for this logic" reasoning as
 * `listEventsByBatch`.
 */
export function listTodosByBatch(batchId: string): TodoDTO[] {
  const rows = db.select().from(todos).where(eq(todos.batchId, batchId)).all();
  return rows.map(serializeTodo);
}

/** Throws `ActionNotFoundError` if `id` doesn't exist. */
export function deleteTodo(id: number): void {
  const existing = db.select().from(todos).where(eq(todos.id, id)).get();
  if (!existing) throw new ActionNotFoundError("Todo not found");
  db.delete(todos).where(eq(todos.id, id)).run();
  broadcast("todos:changed");
}
