import { test, expect } from "@playwright/test";
import { latestVoiceCommand } from "./db";

// ARCHITECTURE.md §10/§12 (M8) — POST /api/voice/command and
// POST /api/voice/confirm. Same spirit as e2e/voice.spec.ts's own header:
// there is no real CLAUDE_CODE_OAUTH_TOKEN available yet, and spawning a
// real headless `claude` process from an automated test would be slow/
// nondeterministic/costly regardless — everything here runs against the
// isolated e2e backend with backend/src/lib/claudeCli.ts's spawn target
// swapped for e2e/mock-claude-cli.mjs (see playwright.config.ts's
// CLAUDE_CLI_COMMAND/CLAUDE_CLI_ARGS_PREFIX), a deterministic stand-in
// driven by trigger substrings in the transcript — never a real Claude
// Code invocation, never real network egress to Anthropic.
//
// Covers: the direct-action fast path (haiku creates something), the
// needs-research escalation path (haiku defers, sonnet finishes and
// creates something), a proposed-destructive-action followed by a real
// POST /api/voice/confirm, a no-action triage, the invocation itself
// failing, and — for every case above — that a voice_commands row got
// written with the right model tier/status/batch id (read straight out of
// the isolated e2e SQLite file, e2e/db.ts, the same "no HTTP surface for
// something only a test needs" pattern already used for push_subscriptions/
// sent_reminders). The missing-CLAUDE_CODE_OAUTH_TOKEN path is covered
// separately, against the same dedicated unconfigured backend instance
// e2e/voice.spec.ts already uses for DEEPGRAM_API_KEY.

const VOICE_UNCONFIGURED_BASE = "http://localhost:4403";

test.describe("POST /api/voice/command", () => {
  test("direct-action fast path: haiku creates a todo, batch id returned, undo works", async ({ page }) => {
    const transcript = "MOCK_ADD_TODO please, direct path test";
    const res = await page.request.post("/api/voice/command", { data: { transcript } });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.outcome).toBe("executed");
    expect(body.modelTier).toBe("haiku");
    expect(typeof body.batchId).toBe("string");
    expect(body.summary).toContain("Buy milk (voice test)");

    const todos = await (await page.request.get("/api/todos")).json();
    expect(todos.some((t: { text: string }) => t.text === "Buy milk (voice test)")).toBe(true);

    const row = latestVoiceCommand(transcript);
    expect(row).toBeTruthy();
    expect(row?.model_tier).toBe("haiku");
    expect(row?.status).toBe("accepted");
    expect(row?.batch_id).toBe(body.batchId);

    // The batch-id/undo round trip: undoing removes exactly what this
    // command created (ARCHITECTURE.md §10a-2's undoBatch, exposed here
    // via POST /api/voice/undo — §10/M8's own minimal HTTP surface for it).
    const undoRes = await page.request.post("/api/voice/undo", { data: { batchId: body.batchId } });
    expect(undoRes.status()).toBe(200);
    const undoBody = await undoRes.json();
    expect(undoBody.deletedTodos).toBe(1);

    const todosAfterUndo = await (await page.request.get("/api/todos")).json();
    expect(todosAfterUndo.some((t: { text: string }) => t.text === "Buy milk (voice test)")).toBe(false);
  });

  test("needs-research path: haiku defers, sonnet researches and creates the event", async ({ page }) => {
    const transcript = "MOCK_NEEDS_RESEARCH please, research path test";
    const res = await page.request.post("/api/voice/command", { data: { transcript } });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.outcome).toBe("executed");
    expect(body.modelTier).toBe("haiku+sonnet-research");
    expect(typeof body.batchId).toBe("string");

    const events = await (await page.request.get("/api/events")).json();
    expect(events.some((e: { title: string }) => e.title === "Researched Game Night (voice test)")).toBe(true);

    const row = latestVoiceCommand(transcript);
    expect(row?.model_tier).toBe("haiku+sonnet-research");
    expect(row?.status).toBe("accepted");
    expect(row?.batch_id).toBe(body.batchId);
  });

  test("a transcript with no actionable intent triages to no_action, not an error", async ({ page }) => {
    const transcript = "MOCK_NOTHING_HERE just chatting, nothing to do";
    const res = await page.request.post("/api/voice/command", { data: { transcript } });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.outcome).toBe("no_action");
    expect(body.batchId).toBeUndefined();

    const row = latestVoiceCommand(transcript);
    expect(row?.status).toBe("rejected");
    expect(row?.batch_id).toBeNull();
  });

  test("the invocation itself failing resolves to outcome: error, not a 500, and is still logged", async ({
    page,
  }) => {
    const transcript = "MOCK_CLAUDE_ERROR simulate a crash";
    const res = await page.request.post("/api/voice/command", { data: { transcript } });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.outcome).toBe("error");
    expect(typeof body.error).toBe("string");

    const row = latestVoiceCommand(transcript);
    expect(row?.status).toBe("error");
    expect(row?.batch_id).toBeNull();
  });

  test("rejects an empty transcript with a 400 before ever invoking the model", async ({ page }) => {
    const res = await page.request.post("/api/voice/command", { data: { transcript: "" } });
    expect(res.status()).toBe(400);
  });

  test("CLAUDE_CODE_OAUTH_TOKEN not configured returns a clear 500, never a raw downstream error", async ({
    request,
  }) => {
    const res = await request.post(`${VOICE_UNCONFIGURED_BASE}/api/voice/command`, {
      data: { transcript: "add milk to the list" },
    });
    expect(res.status()).toBe(500);
    const body = await res.json();
    expect(body.outcome).toBe("error");
    expect(typeof body.error).toBe("string");
    expect(body.error).not.toContain("CLAUDE_CODE_OAUTH_TOKEN");
    expect(body.error.toLowerCase()).not.toContain("undefined");
    expect(body.error.toLowerCase()).not.toContain("at ");
  });
});

test.describe("POST /api/voice/confirm", () => {
  test("a proposed destructive action requires confirmation, then confirm actually executes it", async ({
    page,
  }) => {
    // A real event to target — created through the ordinary REST API, same
    // as a household member would, not specially seeded for this test.
    const created = await (
      await page.request.post("/api/events", {
        data: {
          title: "Dentist appointment (voice test)",
          startAt: new Date(Date.now() + 2 * 24 * 60 * 60_000).toISOString(),
          endAt: new Date(Date.now() + 2 * 24 * 60 * 60_000 + 30 * 60_000).toISOString(),
        },
      })
    ).json();

    const transcript = `MOCK_PROPOSE_DELETE:${created.id}`;
    const commandRes = await page.request.post("/api/voice/command", { data: { transcript } });
    expect(commandRes.status()).toBe(200);
    const commandBody = await commandRes.json();
    expect(commandBody.outcome).toBe("needs_confirmation");
    expect(commandBody.proposedAction).toEqual({
      type: "delete_event",
      targetId: created.id,
      summary: "Delete the test event (voice test)",
      details: {},
    });

    const row = latestVoiceCommand(transcript);
    expect(row?.status).toBe("accepted");
    expect(row?.batch_id).toBeNull(); // proposing never creates anything

    // Nothing was deleted yet — the proposal alone must never execute.
    const eventsBeforeConfirm = await (await page.request.get("/api/events")).json();
    expect(eventsBeforeConfirm.some((e: { id: number }) => e.id === created.id)).toBe(true);

    // The frontend echoes back the exact proposed action (stateless
    // confirm design — see routes/voice.ts's own comment on why).
    const confirmRes = await page.request.post("/api/voice/confirm", { data: commandBody.proposedAction });
    expect(confirmRes.status()).toBe(200);
    expect((await confirmRes.json()).outcome).toBe("executed");

    const eventsAfterConfirm = await (await page.request.get("/api/events")).json();
    expect(eventsAfterConfirm.some((e: { id: number }) => e.id === created.id)).toBe(false);
  });

  test("confirming a target id that no longer exists returns 404, not a crash", async ({ page }) => {
    const res = await page.request.post("/api/voice/confirm", {
      data: { type: "delete_event", targetId: 999_999_999, summary: "doesn't exist", details: {} },
    });
    expect(res.status()).toBe(404);
  });
});
