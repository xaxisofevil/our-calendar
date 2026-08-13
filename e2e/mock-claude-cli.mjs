// A deterministic stand-in for the real `claude` binary, used only by
// e2e/voice-command.spec.ts. There is no real CLAUDE_CODE_OAUTH_TOKEN
// available yet (see ARCHITECTURE.md §10/M8's own "Implementation" note),
// and spawning a real headless Claude Code invocation from an automated
// test would be slow, nondeterministic, and cost real money regardless —
// so the isolated e2e backend's CLAUDE_CLI_COMMAND/CLAUDE_CLI_ARGS_PREFIX
// (playwright.config.ts) point backend/src/lib/claudeCli.ts at this script
// instead of the real `claude` binary. Mirrors e2e/mock-deepgram-server.mjs's
// role for Deepgram exactly — this is the same "stand in for the one real
// external integration a test can't safely exercise for real" pattern,
// just for a spawned process instead of an HTTP call.
//
// Behavior is driven entirely by trigger substrings inside the prompt
// (voice-command.spec.ts's transcripts), the same "the test controls
// exactly what a round-trip produces via plain markers" idea
// mock-deepgram-server.mjs already uses — keeps backend/src/lib/claudeCli.ts
// and lib/voiceCommand.ts completely free of any test-only branch.
//
// For the two triggers that simulate a real create (MOCK_ADD_TODO,
// MOCK_NEEDS_RESEARCH's sonnet-tier response), this writes the resulting
// row directly into the isolated e2e SQLite file (backend/data-e2e/
// our-calendar.sqlite — same file e2e/db.ts already reads from, see that
// file's own comment on why touching this file directly, rather than
// through a route, is this suite's established pattern for reaching things
// the real HTTP surface doesn't expose). This is a deliberate, narrow
// simulation of exactly what mcp/server.ts's create_event/add_todo tools
// would do for real (including tagging the row with VOICE_COMMAND_BATCH_ID,
// inherited from this process's own env exactly the way the real MCP
// server reads it — see mcp/server.ts's own comment) — it proves out the
// batch-id reconciliation mechanism end-to-end without needing the real
// `claude` binary or the real MCP stdio transport, which is Anthropic's
// own tested mechanism, not this app's.
import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, "..", "backend", "data-e2e", "our-calendar.sqlite");

const argv = process.argv.slice(2);
const printIndex = argv.indexOf("--print");
const prompt = printIndex === -1 ? "" : (argv[printIndex + 1] ?? "");
function flagValue(name) {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
}
const model = flagValue("--model");
const batchId = process.env.VOICE_COMMAND_BATCH_ID || null;

function emitEnvelope(structuredOutput, extra = {}) {
  process.stdout.write(
    JSON.stringify({
      is_error: false,
      permission_denials: [],
      result: "(mock claude cli result text)",
      structured_output: structuredOutput,
      ...extra,
    }),
  );
}

function nullOutput(overrides) {
  return { needsResearch: null, actionTaken: null, proposedDestructiveAction: null, ...overrides };
}

function insertTodo(text) {
  const db = new Database(dbPath);
  try {
    const now = new Date().toISOString();
    const maxRow = db.prepare("select max(position) as m from todos").get();
    const nextPosition = (maxRow.m ?? -1) + 1;
    const notes = batchId ? `[batch:${batchId}]` : null;
    db.prepare(
      `insert into todos (text, notes, due_at, completed, list, position, batch_id, created_at, updated_at)
       values (?, ?, NULL, 0, 'household', ?, ?, ?, ?)`,
    ).run(text, notes, nextPosition, batchId, now, now);
  } finally {
    db.close();
  }
}

function insertEvent(title) {
  const db = new Database(dbPath);
  try {
    const now = new Date().toISOString();
    const start = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
    const end = new Date(Date.now() + 25 * 60 * 60_000).toISOString();
    const description = batchId ? `[batch:${batchId}]` : null;
    db.prepare(
      `insert into events (title, description, location, start_at, end_at, all_day, recurrence_rule, batch_id, updated_at)
       values (?, ?, NULL, ?, ?, 0, NULL, ?, ?)`,
    ).run(title, description, start, end, batchId, now);
  } finally {
    db.close();
  }
}

if (prompt.includes("MOCK_CLAUDE_ERROR")) {
  process.stderr.write("mock claude cli: simulated crash\n");
  process.exitCode = 1;
} else if (prompt.includes("MOCK_PERMISSION_DENIED")) {
  emitEnvelope(nullOutput({ actionTaken: "I tried, but I wasn't allowed to." }), {
    permission_denials: [{ tool_name: "mcp__our-calendar__create_event" }],
  });
} else if (prompt.includes("MOCK_ADD_TODO")) {
  insertTodo("Buy milk (voice test)");
  emitEnvelope(nullOutput({ actionTaken: "Added 'Buy milk (voice test)' to the to-do list." }));
} else if (prompt.includes("MOCK_NEEDS_RESEARCH")) {
  if (model === "sonnet") {
    insertEvent("Researched Game Night (voice test)");
    emitEnvelope(nullOutput({ actionTaken: "Added 'Researched Game Night (voice test)' after researching it." }));
  } else {
    emitEnvelope(nullOutput({ needsResearch: "Need to look up the actual game schedule." }));
  }
} else {
  const match = prompt.match(/MOCK_PROPOSE_DELETE:(\d+)/);
  if (match) {
    emitEnvelope(
      nullOutput({
        proposedDestructiveAction: {
          type: "delete_event",
          targetId: Number(match[1]),
          summary: "Delete the test event (voice test)",
          details: {},
        },
      }),
    );
  } else {
    emitEnvelope(nullOutput({ actionTaken: "No actionable command was detected in that transcript." }));
  }
}
