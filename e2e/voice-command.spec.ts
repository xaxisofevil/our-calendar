import { test, expect } from "@playwright/test";

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
// POST /api/voice/confirm, a no-action triage, and the invocation itself
// failing — all asserted straight off the HTTP response body. (There used
// to also be a voice_commands audit-trail row asserted here on every case;
// removed along with the table itself — see lib/voiceCommand.ts's comment.)
// The missing-CLAUDE_CODE_OAUTH_TOKEN path is covered separately, against
// the same dedicated unconfigured backend instance e2e/voice.spec.ts
// already uses for DEEPGRAM_API_KEY.

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
  });

  test("a transcript with no actionable intent triages to no_action, not an error", async ({ page }) => {
    const transcript = "MOCK_NOTHING_HERE just chatting, nothing to do";
    const res = await page.request.post("/api/voice/command", { data: { transcript } });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.outcome).toBe("no_action");
    expect(body.batchId).toBeUndefined();
  });

  test("the invocation itself failing resolves to outcome: error, not a 500", async ({ page }) => {
    const transcript = "MOCK_CLAUDE_ERROR simulate a crash";
    const res = await page.request.post("/api/voice/command", { data: { transcript } });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.outcome).toBe("error");
    expect(typeof body.error).toBe("string");
  });

  test("rolls back MCP writes when the model fails after a tool side effect", async ({ page }) => {
    const res = await page.request.post("/api/voice/command", {
      data: { transcript: "MOCK_CREATE_THEN_ERROR verify rollback" },
    });
    expect(res.status()).toBe(200);
    expect((await res.json()).outcome).toBe("error");

    const todos = await (await page.request.get("/api/todos")).json();
    expect(todos.some((todo: { text: string }) => todo.text === "Must be rolled back (voice test)")).toBe(false);
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
    expect(commandBody.proposedAction).toMatchObject({
      type: "delete_event",
      targetId: created.id,
      details: {},
    });
    expect(commandBody.proposedAction.summary).toContain("Dentist appointment (voice test)");
    expect(commandBody.proposedAction.summary).not.toBe("Delete the test event (voice test)");
    expect(commandBody.confirmationId).toMatch(/^[0-9a-f-]{36}$/i);

    // Nothing was deleted yet — the proposal alone must never execute.
    const eventsBeforeConfirm = await (await page.request.get("/api/events")).json();
    expect(eventsBeforeConfirm.some((e: { id: number }) => e.id === created.id)).toBe(true);

    // Confirmation executes only a server-issued, session-bound, one-time
    // id; the client cannot alter executable target/details.
    const confirmRes = await page.request.post("/api/voice/confirm", {
      data: { confirmationId: commandBody.confirmationId },
    });
    expect(confirmRes.status()).toBe(200);
    expect((await confirmRes.json()).outcome).toBe("executed");

    const replayRes = await page.request.post("/api/voice/confirm", {
      data: { confirmationId: commandBody.confirmationId },
    });
    expect(replayRes.status()).toBe(410);

    const eventsAfterConfirm = await (await page.request.get("/api/events")).json();
    expect(eventsAfterConfirm.some((e: { id: number }) => e.id === created.id)).toBe(false);
  });

  test("rejects an invented confirmation id without accepting executable action fields", async ({ page }) => {
    const res = await page.request.post("/api/voice/confirm", {
      data: { confirmationId: "00000000-0000-4000-8000-000000000000" },
    });
    expect(res.status()).toBe(410);
  });
});
