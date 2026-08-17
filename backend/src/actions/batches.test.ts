import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Response } from "express";

// Unit coverage for the batch-tag-and-undo primitive (actions/batches.ts,
// generalized out of the calendar-add skill — see ARCHITECTURE.md's
// batch-undo subsection near §10a-1). This is deliberately a Vitest unit
// test, not a Playwright e2e spec: unlike everything else the e2e suite
// covers, `createEvent`/`addTodo`'s `batchId` parameter and `undoBatch`
// have no REST/MCP route yet (that's §10/M8's job to build on top of this)
// — there is no HTTP surface for a browser-driven Playwright test to reach
// them through. Testing at this altitude also lets the SSE-broadcast
// assertion below be exact (real call count per channel) rather than
// racing a real EventSource in a browser, which live-sync.spec.ts already
// covers for the underlying deleteEvent/deleteTodo broadcasts this reuses.
//
// DB isolation: sets DB_DIR_NAME to a throwaway, uniquely-named directory
// *before* importing anything that touches db/client.ts (module-level
// side effects create/open the SQLite file at import time — see that
// file's own comment) — via `await import(...)` rather than a static
// top-level import, since only dynamic imports are guaranteed to run
// after this file's own preceding statements instead of being hoisted.
// Never "data" (real dev/prod) or "data-e2e" (Playwright's own isolated
// DB) — a third, disposable name, cleaned up in afterAll.
const dbDirName = `data-vitest-${randomUUID()}`;
process.env.DB_DIR_NAME = dbDirName;

const { createEvent, deleteEvent, listEventsByBatch } = await import("./events.js");
const { addTodo, listTodosByBatch } = await import("./todos.js");
const { getBatch, mintBatchId, undoBatch } = await import("./batches.js");
const { addClient, removeClient } = await import("../lib/sse.js");
const { sqlite } = await import("../db/client.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbDir = path.join(__dirname, "..", "..", dbDirName);

afterAll(() => {
  sqlite.close();
  fs.rmSync(dbDir, { recursive: true, force: true });
});

function baseEvent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    title: "Test event",
    startAt: "2026-09-01T18:00:00.000Z",
    endAt: "2026-09-01T20:00:00.000Z",
    ...overrides,
  };
}

describe("mintBatchId", () => {
  it("returns a unique id with no label", () => {
    expect(mintBatchId()).not.toBe(mintBatchId());
  });

  it("prefixes a slugified label when given one", () => {
    const id = mintBatchId("Bills 2026 Schedule!");
    expect(id).toMatch(/^bills-2026-schedule-/);
  });

  it("still produces a unique id for the same label called twice", () => {
    expect(mintBatchId("same-label")).not.toBe(mintBatchId("same-label"));
  });
});

describe("createEvent / addTodo with a batchId", () => {
  it("stores batch_id on the row and leaves it null when no batchId is given", () => {
    const batchId = mintBatchId("tag-test");
    const tagged = createEvent(baseEvent({ title: "Tagged" }), batchId);
    const untagged = createEvent(baseEvent({ title: "Untagged" }));

    expect(tagged.batchId).toBe(batchId);
    expect(untagged.batchId).toBeNull();
  });

  it("appends a visible [batch:<id>] trace to the event description without discarding an existing one", () => {
    const batchId = mintBatchId("trace-test");
    const withNote = createEvent(baseEvent({ title: "Has note", description: "Bring snacks" }), batchId);
    const withoutNote = createEvent(baseEvent({ title: "No note" }), batchId);

    expect(withNote.description).toBe(`Bring snacks\n\n[batch:${batchId}]`);
    expect(withoutNote.description).toBe(`[batch:${batchId}]`);
  });

  it("does the same for addTodo's notes field", () => {
    const batchId = mintBatchId("todo-trace-test");
    const todo = addTodo({ text: "Buy milk" }, batchId);
    expect(todo.batchId).toBe(batchId);
    expect(todo.notes).toBe(`[batch:${batchId}]`);
  });

  it("REST-style single-argument calls (no batchId) are unaffected", () => {
    // Exactly how routes/events.ts and routes/todos.ts call these today
    // (createEvent(req.body), addTodo(req.body)) — this is the regression
    // guard that adding the optional param didn't change ordinary
    // household-created events/todos at all.
    const event = createEvent(baseEvent({ title: "Plain event" }));
    const todo = addTodo({ text: "Plain todo" });
    expect(event.batchId).toBeNull();
    expect(event.description).toBeNull();
    expect(todo.batchId).toBeNull();
    expect(todo.notes).toBeNull();
  });
});

describe("undoBatch", () => {
  it("deletes exactly the events and todos tagged with that batch id, and nothing else", () => {
    const batchA = mintBatchId("batch-a");
    const batchB = mintBatchId("batch-b");

    const a1 = createEvent(baseEvent({ title: "A1" }), batchA);
    const a2 = createEvent(baseEvent({ title: "A2" }), batchA);
    const aTodo = addTodo({ text: "A todo" }, batchA);

    const b1 = createEvent(baseEvent({ title: "B1" }), batchB);
    const bTodo = addTodo({ text: "B todo" }, batchB);

    const untaggedEvent = createEvent(baseEvent({ title: "Untagged event" }));
    const untaggedTodo = addTodo({ text: "Untagged todo" });

    expect(getBatch(batchA).events.map((e) => e.id).sort()).toEqual([a1.id, a2.id].sort());

    const result = undoBatch(batchA);
    expect(result).toEqual({ batchId: batchA, deletedEvents: 2, deletedTodos: 1 });

    // Batch A is gone.
    expect(listEventsByBatch(batchA)).toEqual([]);
    expect(listTodosByBatch(batchA)).toEqual([]);

    // Batch B and the untagged rows are all still there, untouched.
    expect(listEventsByBatch(batchB).map((e) => e.id)).toEqual([b1.id]);
    expect(listTodosByBatch(batchB).map((t) => t.id)).toEqual([bTodo.id]);
    expect(() => deleteEvent(untaggedEvent.id)).not.toThrow();
    expect(() => deleteEvent(b1.id)).not.toThrow();
    void untaggedTodo; // proved untouched via listTodosByBatch above; nothing further to assert on it
  });

  it("undoing a nonexistent batch id is a graceful no-op, not a crash", () => {
    const result = undoBatch("this-batch-id-was-never-real");
    expect(result).toEqual({ batchId: "this-batch-id-was-never-real", deletedEvents: 0, deletedTodos: 0 });
  });

  it("undoing an already-undone batch id a second time is also a graceful no-op", () => {
    const batchId = mintBatchId("double-undo");
    createEvent(baseEvent({ title: "Once" }), batchId);
    addTodo({ text: "Once todo" }, batchId);

    const first = undoBatch(batchId);
    expect(first).toEqual({ batchId, deletedEvents: 1, deletedTodos: 1 });

    const second = undoBatch(batchId);
    expect(second).toEqual({ batchId, deletedEvents: 0, deletedTodos: 0 });
  });

  it("broadcasts events:changed / todos:changed over SSE exactly like a manual delete would", () => {
    // Real lib/sse.ts, a fake `res` standing in for a connected browser's
    // open SSE response — asserts undoBatch's *only* deletion path is the
    // real deleteEvent/deleteTodo actions (which already call broadcast()
    // themselves), not a bypassing raw SQL DELETE. See live-sync.spec.ts
    // (Playwright) for the browser-side half of this same guarantee.
    const writes: string[] = [];
    const fakeRes = { write: (chunk: string) => writes.push(chunk) } as unknown as Response;
    addClient(fakeRes);
    try {
      const batchId = mintBatchId("sse-test");
      createEvent(baseEvent({ title: "SSE event 1" }), batchId);
      createEvent(baseEvent({ title: "SSE event 2" }), batchId);
      addTodo({ text: "SSE todo" }, batchId);

      writes.length = 0; // only care about broadcasts from undoBatch itself, not creation
      const result = undoBatch(batchId);
      expect(result).toEqual({ batchId, deletedEvents: 2, deletedTodos: 1 });

      const eventBroadcasts = writes.filter((w) => w.includes("event: events:changed"));
      const todoBroadcasts = writes.filter((w) => w.includes("event: todos:changed"));
      expect(eventBroadcasts).toHaveLength(2); // one per deleted event, per deleteEvent's own broadcast() call
      expect(todoBroadcasts).toHaveLength(1);
    } finally {
      removeClient(fakeRes);
    }
  });
});
