#!/usr/bin/env node
// Local stdio MCP server (ARCHITECTURE.md §10a). A thin wrapper around the
// shared action layer (../actions/*.ts) — every tool below calls straight
// into the same functions `routes/*.ts` calls, so there is exactly one
// implementation of "add a todo" / "create an event" / etc., not a second
// one reimplemented here. Input schemas are the same zod schemas used for
// REST validation (backend/src/lib/validation.ts), extended with an `id`
// field where a tool targets an existing row, rather than redefined.
//
// Transport is stdio, not HTTP/SSE — see §10a: this runs on the same
// Windows PC as the backend, so there's no networking/auth surface to
// build. It opens its own connection to the *same* SQLite file the running
// backend uses (backend/src/db/client.ts, WAL mode already handles
// multiple local connections) — it does not spin up a second DB or
// duplicate schema logic.
//
// Registration: see ARCHITECTURE.md §10a's "Registering the server"
// subsection for the exact `claude mcp add` command.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  ActionNotFoundError,
  ActionValidationError,
  addTodo,
  completeTodo,
  createEvent,
  deleteEvent,
  deleteTodo,
  listEvents,
  listPeople,
  listTodos,
  updateEvent,
  updateTodo,
} from "../actions/index.js";
import { createEventSchema, createTodoSchema, updateEventSchema, updateTodoSchema } from "../lib/validation.js";

function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function errorResult(message: string) {
  return { isError: true, content: [{ type: "text" as const, text: message }] };
}

// Wraps an action call, translating actions/errors.ts's typed errors into an
// MCP tool-error result (isError: true) instead of letting them throw across
// the protocol boundary as an internal server error — the MCP-side analogue
// of routes/*.ts's try/catch -> res.status(400|404).json(...).
function runAction<T>(fn: () => T) {
  try {
    return textResult(fn());
  } catch (err) {
    if (err instanceof ActionValidationError) {
      return errorResult(`Validation failed: ${JSON.stringify(err.issues)}`);
    }
    if (err instanceof ActionNotFoundError) {
      return errorResult(err.message);
    }
    throw err;
  }
}

// ARCHITECTURE.md §10/§12 (M8) — reconciling "the LLM calls create_event/
// add_todo directly" with "every row this command creates needs the same
// batch id for undo" (§10a-2). Read once at process startup (this server
// process lives for exactly one `claude -p` invocation's duration — see
// lib/voiceCommand.ts's comment on why): when the voice command layer
// spawns `claude`, it sets VOICE_COMMAND_BATCH_ID on that child process's
// env, which Claude Code's own MCP-server-spawning inherits down to this
// process the same way any child process inherits its parent's env unless
// overridden. Every create_event/add_todo call made through *this*
// server instance is tagged with it automatically — the model never sees
// or sets a batch id itself, so there's nothing for it to get wrong or
// need to be told to echo back.
//
// undefined for every other caller of this same server (a human typing a
// request directly at `claude`, the interactive case this server was
// originally built for in §10a) — those creates are untagged, exactly as
// before this existed. This is the one piece of §10/M8 that lives outside
// backend/src/lib/voiceCommand.ts itself, because the reconciliation only
// works if the tagging happens inside the same process that actually
// receives the tool call — see ARCHITECTURE.md's M8 Implementation note
// for the fuller reasoning, including the honest caveat that this
// specific env-inheritance chain (backend -> claude -p -> this server)
// hasn't yet been exercised against a real `claude` binary (no real
// CLAUDE_CODE_OAUTH_TOKEN was available while this was built — see that
// same note).
const voiceCommandBatchId = process.env.VOICE_COMMAND_BATCH_ID || undefined;
const MAX_VOICE_CREATES = 20;
let voiceCreateCount = 0;

function runCreate<T>(fn: () => T) {
  if (voiceCommandBatchId && voiceCreateCount >= MAX_VOICE_CREATES) {
    return errorResult(`Voice commands may create at most ${MAX_VOICE_CREATES} items.`);
  }
  const result = runAction(fn);
  if (voiceCommandBatchId && !("isError" in result)) voiceCreateCount++;
  return result;
}

const server = new McpServer({ name: "our-calendar", version: "0.1.0" });

const idSchema = z.object({ id: z.number().int().describe("Row id") });
const noArgsSchema = z.object({});

const listEventsToolSchema = z.object({
  start: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("Range start, YYYY-MM-DD. Provide together with `end` to expand recurring events into occurrences."),
  end: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("Range end (inclusive), YYYY-MM-DD."),
});

// Reuses the REST update schema, just adding the `id` the route otherwise
// takes from the URL path.
const updateEventToolSchema = updateEventSchema.extend({ id: z.number().int().describe("Event id") });
const updateTodoToolSchema = updateTodoSchema.extend({ id: z.number().int().describe("Todo id") });

server.registerTool(
  "list_events",
  {
    title: "List events",
    description:
      "List calendar events. Pass start and end (YYYY-MM-DD) together to expand recurring events into their occurrences within that range (ARCHITECTURE.md §7a). Omit both to get unexpanded master rows.",
    inputSchema: listEventsToolSchema,
  },
  async (args) => runAction(() => listEvents(args.start && args.end ? { start: args.start, end: args.end } : undefined)),
);

server.registerTool(
  "create_event",
  {
    title: "Create event",
    description:
      "Create a new calendar event. Set recurrenceRule to a bare RFC 5545 RRULE string (e.g. \"FREQ=WEEKLY;BYDAY=TH\") to make it recurring; omit it for a one-off event.",
    inputSchema: createEventSchema,
  },
  async (args) => runCreate(() => createEvent(args, voiceCommandBatchId)),
);

server.registerTool(
  "update_event",
  {
    title: "Update event",
    description: "Edit an existing event by id. For a recurring event, this edits the whole series (no per-occurrence edits in v1).",
    inputSchema: updateEventToolSchema,
  },
  async (args) => {
    const { id, ...rest } = args;
    return runAction(() => updateEvent(id, rest));
  },
);

server.registerTool(
  "delete_event",
  {
    title: "Delete event",
    description: "Delete an event by id. For a recurring event, this deletes the whole series.",
    inputSchema: idSchema,
  },
  async (args) =>
    runAction(() => {
      deleteEvent(args.id);
      return { deleted: args.id };
    }),
);

server.registerTool(
  "list_todos",
  {
    title: "List todos",
    description: "List all items on the shared household to-do list, in their display order.",
    inputSchema: noArgsSchema,
  },
  async () => runAction(() => listTodos()),
);

server.registerTool(
  "add_todo",
  {
    title: "Add todo",
    description: "Add a new item to the shared household to-do list.",
    inputSchema: createTodoSchema,
  },
  async (args) => runCreate(() => addTodo(args, voiceCommandBatchId)),
);

server.registerTool(
  "complete_todo",
  {
    title: "Complete todo",
    description: "Mark a todo as completed by id.",
    inputSchema: idSchema,
  },
  async (args) => runAction(() => completeTodo(args.id)),
);

server.registerTool(
  "update_todo",
  {
    title: "Update todo",
    description: "Edit a todo's text, notes, due date, or list, or change its sort position, by id.",
    inputSchema: updateTodoToolSchema,
  },
  async (args) => {
    const { id, ...rest } = args;
    return runAction(() => updateTodo(id, rest));
  },
);

server.registerTool(
  "delete_todo",
  {
    title: "Delete todo",
    description: "Delete a todo by id.",
    inputSchema: idSchema,
  },
  async (args) =>
    runAction(() => {
      deleteTodo(args.id);
      return { deleted: args.id };
    }),
);

server.registerTool(
  "list_people",
  {
    title: "List people",
    description: "List household members (read-only, fixed set of 4 — Eric, Lindsay, Gavin, Damien).",
    inputSchema: noArgsSchema,
  },
  async () => runAction(() => listPeople()),
);

const transport = new StdioServerTransport();
await server.connect(transport);
