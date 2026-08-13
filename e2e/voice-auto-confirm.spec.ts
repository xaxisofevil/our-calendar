import { test, expect, type Page } from "@playwright/test";

// ARCHITECTURE.md §10b (M9) — the auto-listen confirm feature: when a
// needs_confirmation voice-command result appears, the mic opens itself
// (no new tap) and listens for up to 10s (overridden short here, see
// installAutoListenTiming below), evaluating whatever it hears against
// voiceConfirmWhitelist.ts's whitelist+confidence gate. Same "no real mic
// reachable headlessly" situation as voice.spec.ts/voice-command.spec.ts —
// everything here runs against the same isolated e2e backend (mock
// Deepgram server + e2e/mock-claude-cli.mjs), with the browser's
// getUserMedia/MediaRecorder mocked via page.addInitScript and driven by a
// *sequence* of fake clips (index 0 = the initial press-and-hold command,
// index 1 = the auto-listen attempt) rather than voice.spec.ts's single
// fixed clip, since this feature's whole point is a *second*,
// self-triggered recording after the first one resolves.
//
// Covers: a clear "yes" auto-confirms (the real DELETE actually happens);
// a clear "no" auto-cancels (nothing is deleted, no server call at all —
// cancelAction is client-side only per routes/voice.ts's stateless-confirm
// design); a silent/empty second clip (standing in for "timed out with
// nothing usable") leaves the manual buttons up and still working; a
// whitelist-matching but low-confidence second clip does the same; and
// getUserMedia failing on the *second* call (the auto-listen one, after
// the *first* call — the manual recording's own permission prompt —
// already succeeded) degrades silently to manual-only without breaking
// the manual Confirm button.

/** Speeds up the hard recording-length cap (useAutoListenConfirm.ts's
 * MAX_RECORD_MS, normally 10s) via its documented test-only `window`
 * override, read once when that module first evaluates — must run before
 * page.goto() so it's set before any app script imports the hook. Real
 * silence-detection (the AnalyserNode path) never engages in this suite
 * regardless, because the fake getUserMedia() stream below isn't a real
 * MediaStream a real AudioContext can attach to (createMediaStreamSource
 * throws, which the hook catches and treats as "fall back to the flat
 * timeout" — see that file's own comment) — this override is what keeps
 * that fallback path fast instead of making every test here wait out a
 * real 10 seconds. */
async function installAutoListenTiming(page: Page, maxMs = 150) {
  await page.addInitScript((ms) => {
    (window as unknown as Record<string, number>).__AUTO_LISTEN_MAX_MS__ = ms;
  }, maxMs);
}

/** Registers fake `navigator.mediaDevices.getUserMedia`/`window.MediaRecorder`
 * implementations, driven by a sequence of per-call entries:
 *   - a string  -> that text becomes the "recorded" clip's raw bytes (sent
 *     verbatim to POST /api/voice/transcribe, exactly like voice.spec.ts's
 *     own mock — the mock Deepgram server, e2e/mock-deepgram-server.mjs,
 *     decides the transcript/confidence from those bytes).
 *   - null      -> getUserMedia() succeeds but the resulting clip is empty
 *     (no ondataavailable data at all) — stands in for silence/"nothing
 *     usable by the time the cap was hit."
 *   - "THROW"   -> that call's getUserMedia() rejects, simulating a real
 *     failure (permission somehow unavailable, browser quirk, ...).
 * Calls past the end of `entries` repeat the last entry. */
async function mockSequentialMic(page: Page, entries: (string | null)[]) {
  await page.addInitScript((seq) => {
    let callIndex = 0;

    class FakeMediaRecorder extends EventTarget {
      state: "inactive" | "recording" = "inactive";
      mimeType = "audio/webm";
      ondataavailable: ((e: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      private text: string | null;
      constructor(stream: { __fakeText: string | null }) {
        super();
        this.text = stream.__fakeText;
      }
      start() {
        this.state = "recording";
      }
      stop() {
        this.state = "inactive";
        if (this.text != null) {
          this.ondataavailable?.({ data: new Blob([this.text], { type: "text/plain" }) });
        }
        this.onstop?.();
      }
    }
    // @ts-expect-error - test-only stub, real MediaRecorder isn't reachable headlessly
    window.MediaRecorder = FakeMediaRecorder;

    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => {
          const idx = Math.min(callIndex, seq.length - 1);
          callIndex++;
          const entry = seq[idx];
          if (entry === "THROW") {
            const err = new Error("Auto-listen getUserMedia failure (test)");
            err.name = "NotFoundError";
            throw err;
          }
          return { getTracks: () => [], __fakeText: entry };
        },
      },
    });
  }, entries);
}

/** Press-and-hold the mic button (ARCHITECTURE.md §9 — push-to-talk is a
 * hold, not a tap-to-toggle). */
async function pressAndHoldMic(page: Page, holdMs = 150) {
  const button = page.getByRole("button", { name: /talk|recording|transcribing|voice input/i });
  const box = await button.boundingBox();
  if (!box) throw new Error("mic button has no bounding box");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.waitForTimeout(holdMs);
  await page.mouse.up();
}

/** Creates a real event via the ordinary REST API (same as a household
 * member would) and returns its id, for MOCK_PROPOSE_DELETE:<id> to target
 * — mirrors e2e/voice-command.spec.ts's own confirm test setup exactly. */
async function createTargetEvent(page: Page, title: string): Promise<number> {
  const created = await (
    await page.request.post("/api/events", {
      data: {
        title,
        startAt: new Date(Date.now() + 3 * 24 * 60 * 60_000).toISOString(),
        endAt: new Date(Date.now() + 3 * 24 * 60 * 60_000 + 30 * 60_000).toISOString(),
      },
    })
  ).json();
  return created.id;
}

test.describe("Voice-driven auto-listen confirm (UI)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("a clear, high-confidence 'yes' auto-confirms — the event is really deleted", async ({ page }) => {
    const eventId = await createTargetEvent(page, "Auto-confirm yes target (voice test)");
    await installAutoListenTiming(page);
    // Index 0: the initial press-and-hold command ("MOCK_PROPOSE_DELETE:<id>").
    // Index 1: the auto-listen clip — a plain, clearly-said "yes" (the mock
    // Deepgram server's default path gives every word a high 0.97
    // confidence unless a CONF: prefix says otherwise).
    await mockSequentialMic(page, [`MOCK_PROPOSE_DELETE:${eventId}`, "yes"]);
    await page.goto("/");

    await pressAndHoldMic(page);
    await expect(page.getByText("Delete the test event (voice test)")).toBeVisible();

    // No manual tap on Confirm anywhere in this test — the auto-listen
    // path alone is what has to produce this outcome.
    await expect(page.getByText("Done — that's been applied.")).toBeVisible({ timeout: 10_000 });

    const events = await (await page.request.get("/api/events")).json();
    expect(events.some((e: { id: number }) => e.id === eventId)).toBe(false);
  });

  test("a clear, high-confidence 'no' auto-cancels — nothing is deleted", async ({ page }) => {
    const eventId = await createTargetEvent(page, "Auto-cancel no target (voice test)");
    await installAutoListenTiming(page);
    await mockSequentialMic(page, [`MOCK_PROPOSE_DELETE:${eventId}`, "no"]);
    await page.goto("/");

    await pressAndHoldMic(page);
    await expect(page.getByText("Delete the test event (voice test)")).toBeVisible();

    await expect(page.getByText("Cancelled — nothing was changed.")).toBeVisible({ timeout: 10_000 });

    const events = await (await page.request.get("/api/events")).json();
    expect(events.some((e: { id: number }) => e.id === eventId)).toBe(true);
  });

  test("silence/timeout (nothing usable) leaves the manual buttons up and working", async ({ page }) => {
    const eventId = await createTargetEvent(page, "Auto-listen silence target (voice test)");
    await installAutoListenTiming(page);
    // null => the auto-listen clip is empty (no audio data at all) —
    // useAutoListenConfirm.ts aborts silently on a zero-byte blob without
    // ever calling POST /api/voice/transcribe a second time.
    await mockSequentialMic(page, [`MOCK_PROPOSE_DELETE:${eventId}`, null]);
    await page.goto("/");

    await pressAndHoldMic(page);
    await expect(page.getByText("Delete the test event (voice test)")).toBeVisible();

    // Give the (sped-up) auto-listen window time to fully elapse.
    await page.waitForTimeout(500);

    // Nothing was auto-decided — the proposal's summary and the manual
    // Confirm/Cancel pair are still exactly where they were.
    await expect(page.getByText("Delete the test event (voice test)")).toBeVisible();
    const confirmButton = page.getByRole("button", { name: "Confirm" });
    await expect(confirmButton).toBeVisible();

    const eventsBefore = await (await page.request.get("/api/events")).json();
    expect(eventsBefore.some((e: { id: number }) => e.id === eventId)).toBe(true);

    // The manual path must still work after an auto-listen attempt that
    // found nothing usable.
    await confirmButton.click();
    await expect(page.getByText("Done — that's been applied.")).toBeVisible();
    const eventsAfter = await (await page.request.get("/api/events")).json();
    expect(eventsAfter.some((e: { id: number }) => e.id === eventId)).toBe(false);
  });

  test("a whitelist match at low confidence leaves the manual buttons up, doesn't auto-act", async ({ page }) => {
    const eventId = await createTargetEvent(page, "Auto-listen low-confidence target (voice test)");
    await installAutoListenTiming(page);
    // The mock Deepgram server's CONF:<value>: prefix (e2e/mock-deepgram-server.mjs)
    // lets this test say exactly what confidence Deepgram "assigns" to the
    // word "no" here — 0.3, well under voiceConfirmWhitelist.ts's 0.8 gate.
    // Whitelist match alone must never be enough on its own.
    await mockSequentialMic(page, [`MOCK_PROPOSE_DELETE:${eventId}`, "CONF:0.3:no"]);
    await page.goto("/");

    await pressAndHoldMic(page);
    await expect(page.getByText("Delete the test event (voice test)")).toBeVisible();

    await page.waitForTimeout(500);

    await expect(page.getByText("Delete the test event (voice test)")).toBeVisible();
    await expect(page.getByRole("button", { name: "Confirm" })).toBeVisible();
    const eventsBefore = await (await page.request.get("/api/events")).json();
    expect(eventsBefore.some((e: { id: number }) => e.id === eventId)).toBe(true);
  });

  test("getUserMedia failing during auto-listen degrades silently — manual Confirm still works", async ({
    page,
  }) => {
    const eventId = await createTargetEvent(page, "Auto-listen getUserMedia-failure target (voice test)");
    await installAutoListenTiming(page);
    // Index 0 (the manual press-and-hold recording) succeeds normally;
    // index 1 (auto-listen's own getUserMedia() call, fired with no user
    // gesture the moment the confirmation state appears) rejects — this is
    // the scenario ARCHITECTURE.md §10b's own defensive design targets.
    await mockSequentialMic(page, [`MOCK_PROPOSE_DELETE:${eventId}`, "THROW"]);
    await page.goto("/");

    await pressAndHoldMic(page);
    await expect(page.getByText("Delete the test event (voice test)")).toBeVisible();

    // No error message anywhere — a failed auto-listen attempt is
    // deliberately invisible, not surfaced as a voice-capture error.
    await page.waitForTimeout(500);
    await expect(page.getByText(/microphone|couldn.t|something went wrong/i)).not.toBeVisible();

    const confirmButton = page.getByRole("button", { name: "Confirm" });
    await expect(confirmButton).toBeVisible();
    await confirmButton.click();
    await expect(page.getByText("Done — that's been applied.")).toBeVisible();

    const events = await (await page.request.get("/api/events")).json();
    expect(events.some((e: { id: number }) => e.id === eventId)).toBe(false);
  });
});
