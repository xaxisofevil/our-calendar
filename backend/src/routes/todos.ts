import { Router } from "express";
import { ActionNotFoundError, ActionValidationError, addTodo, deleteTodo, listTodos, updateTodo } from "../actions/index.js";

export const todosRouter = Router();

todosRouter.get("/", (_req, res) => {
  res.json(listTodos());
});

todosRouter.post("/", (req, res) => {
  try {
    const todo = addTodo(req.body);
    res.status(201).json(todo);
  } catch (err) {
    if (err instanceof ActionValidationError) {
      res.status(400).json({ error: err.issues });
      return;
    }
    throw err;
  }
});

todosRouter.patch("/:id", (req, res) => {
  const id = Number(req.params.id);
  try {
    const todo = updateTodo(id, req.body);
    res.json(todo);
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

todosRouter.delete("/:id", (req, res) => {
  const id = Number(req.params.id);
  try {
    deleteTodo(id);
    res.status(204).end();
  } catch (err) {
    if (err instanceof ActionNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    throw err;
  }
});
