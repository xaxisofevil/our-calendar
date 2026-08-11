import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, sqlite } from "../db/client.js";
import { todos } from "../db/schema.js";
import { createTodoSchema, updateTodoSchema } from "../lib/validation.js";

export const todosRouter = Router();

type TodoRow = typeof todos.$inferSelect;

function serializeTodo(row: TodoRow) {
  return {
    id: row.id,
    text: row.text,
    notes: row.notes,
    completed: Boolean(row.completed),
    list: row.list,
    position: row.position,
  };
}

todosRouter.get("/", (_req, res) => {
  const rows = db.select().from(todos).orderBy(todos.position).all();
  res.json(rows.map(serializeTodo));
});

todosRouter.post("/", (req, res) => {
  const parsed = createTodoSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const now = new Date().toISOString();
  const maxRow = sqlite.prepare("select max(position) as m from todos").get() as { m: number | null };
  const nextPosition = (maxRow.m ?? -1) + 1;

  const result = db
    .insert(todos)
    .values({
      text: parsed.data.text,
      notes: parsed.data.notes ?? null,
      list: parsed.data.list ?? "household",
      completed: false,
      position: nextPosition,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  const row = db
    .select()
    .from(todos)
    .where(eq(todos.id, Number(result.lastInsertRowid)))
    .get();
  res.status(201).json(serializeTodo(row!));
});

todosRouter.patch("/:id", (req, res) => {
  const id = Number(req.params.id);
  const parsed = updateTodoSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const existing = db.select().from(todos).where(eq(todos.id, id)).get();
  if (!existing) {
    res.status(404).json({ error: "Todo not found" });
    return;
  }
  const now = new Date().toISOString();
  db.update(todos)
    .set({ ...parsed.data, updatedAt: now })
    .where(eq(todos.id, id))
    .run();
  const row = db.select().from(todos).where(eq(todos.id, id)).get();
  res.json(serializeTodo(row!));
});

todosRouter.delete("/:id", (req, res) => {
  const id = Number(req.params.id);
  const existing = db.select().from(todos).where(eq(todos.id, id)).get();
  if (!existing) {
    res.status(404).json({ error: "Todo not found" });
    return;
  }
  db.delete(todos).where(eq(todos.id, id)).run();
  res.status(204).end();
});
