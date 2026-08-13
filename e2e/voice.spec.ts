import { test, expect } from "@playwright/test";

// ARCHITECTURE.md §9 (M7) — Deepgram-backed voice transcription
// (POST /api/voice/transcribe + the push-to-talk VoiceButton UI). Real
// microphone capture can't be exercised from an automated suite (no real
// mic in CI) and there is no real DEEPGRAM_API_KEY available yet (see §9's
// own "Implementation" note) — what *is* verified here, entirely against
// isolated instances, never the real dev/prod backend:
//
//  - the real POST /api/voice/transcribe success path, against the
//    isolated e2e backend pointed at a local mock Deepgram server
//    (e2e/mock-deepgram-server.mjs) instead of the real API — see
//    playwright.config.ts's DEEPGRAM_API_URL.
//  - an empty/silent clip returning `{ transcript: "" }`, not an error.
//  - a genuinely missing audio body being rejected with 400.
//  - Deepgram itself erroring is sanitized into a 502 before reaching the
//    client (the real upstream error body/detail is never relayed).
//  - the "DEEPGRAM_API_KEY isn't configured" 500 path, against a second,
//    minimal backend instance that deliberately has no key set
//    (playwright.config.ts) — see that file's own comment for why this
//    needs to be a separate process rather than reconfiguring the primary
//    shared backend mid-suite.
//  - the real push-to-talk UI flow (VoiceButton.tsx/useVoiceCapture.ts),
//    with the browser's MediaRecorder/getUserMedia mocked — same spirit as
//    push-notifications.spec.ts mocking Notification/PushManager, since no
//    real microphone is reachable headlessly — covering a successful
//    round-trip, mic permission denied, no MediaRecorder support, and an
//    upload/network failure.
//
// Nothing here executes a command from a transcript — that's §10's command
// layer, explicitly out of scope for §9/M7 (see ARCHITECTURE.md). The
// transcript is only ever displayed, never acted on.

const VOICE_UNCONFIGURED_BASE = "http://localhost:4403";

test.describe("POST /api/voice/transcribe", () => {
  test("transcribes a clip and returns the transcript text", async ({ page }) => {
    const res = await page.request.post("/api/voice/transcribe", {
      data: Buffer.from("add milk to the list"),
      headers: { "Content-Type": "audio/webm" },
    });
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ transcript: "add milk to the list" });
  });

  test("a silent/unintelligible clip returns an empty transcript, not an error", async ({ page }) => {
    const res = await page.request.post("/api/voice/transcribe", {
      data: Buffer.from("SILENT_CLIP"),
      headers: { "Content-Type": "audio/webm" },
    });
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ transcript: "" });
  });

  test("rejects a request with no audio body at all", async ({ page }) => {
    const res = await page.request.post("/api/voice/transcribe", {
      data: Buffer.alloc(0),
      headers: { "Content-Type": "audio/webm" },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  test("a Deepgram API error is sanitized into a 502, never relaying the upstream body", async ({ page }) => {
    const res = await page.request.post("/api/voice/transcribe", {
      data: Buffer.from("TRIGGER_DEEPGRAM_ERROR"),
      headers: { "Content-Type": "audio/webm" },
    });
    expect(res.status()).toBe(502);
    const body = await res.json();
    expect(typeof body.error).toBe("string");
    // The mock server's raw error body (e2e/mock-deepgram-server.mjs) must
    // never reach the client.
    expect(body.error).not.toContain("mock upstream failure detail");
    expect(body.error).not.toContain("err_msg");
    expect(body.error).not.toContain("INTERNAL_SERVER_ERROR");
  });

  test("DEEPGRAM_API_KEY not configured returns a clear 500, never a raw downstream error", async ({ request }) => {
    // Hits the second, dedicated backend instance (playwright.config.ts)
    // that deliberately has no DEEPGRAM_API_KEY set — no AUTH_PASSCODE
    // configured for it either (requireAuth's no-op-when-unset escape
    // hatch), so no session cookie is needed to reach it directly.
    const res = await request.post(`${VOICE_UNCONFIGURED_BASE}/api/voice/transcribe`, {
      data: Buffer.from("hello"),
      headers: { "Content-Type": "audio/webm" },
    });
    expect(res.status()).toBe(500);
    const body = await res.json();
    expect(typeof body.error).toBe("string");
    // Never leaks the env var name/value or a raw stack trace to the client.
    expect(body.error).not.toContain("DEEPGRAM_API_KEY");
    expect(body.error.toLowerCase()).not.toContain("undefined");
    expect(body.error.toLowerCase()).not.toContain("at ");
  });
});

test.describe("Push-to-talk voice button (UI)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  /** Registers fake `navigator.mediaDevices.getUserMedia`/`window.MediaRecorder`
   * implementations before any page script runs (Playwright guarantee for
   * addInitScript) — there's no real microphone reachable headlessly, and
   * even where a browser API technically exists, headless Chromium has no
   * real device to grant permission for. The fake MediaRecorder emits
   * `fakeAudioText`'s bytes as its one `ondataavailable` chunk when
   * stopped, which the mock Deepgram server (e2e/mock-deepgram-server.mjs)
   * echoes back as the transcript — letting a test control the exact
   * transcript a real round-trip produces. */
  async function mockWorkingMic(page: import("@playwright/test").Page, fakeAudioText: string) {
    await page.addInitScript((text) => {
      class FakeMediaRecorder extends EventTarget {
        stream: MediaStream;
        state: "inactive" | "recording" = "inactive";
        mimeType = "audio/webm";
        ondataavailable: ((e: { data: Blob }) => void) | null = null;
        onstop: (() => void) | null = null;
        constructor(stream: MediaStream) {
          super();
          this.stream = stream;
        }
        start() {
          this.state = "recording";
        }
        stop() {
          this.state = "inactive";
          this.ondataavailable?.({ data: new Blob([text], { type: "text/plain" }) });
          this.onstop?.();
        }
      }
      // @ts-expect-error - test-only stub, real MediaRecorder isn't reachable headlessly
      window.MediaRecorder = FakeMediaRecorder;
      // `navigator.mediaDevices` is a getter-only property in real Chrome —
      // a bare assignment silently no-ops (or throws in strict mode)
      // instead of actually replacing it, so this uses defineProperty the
      // same way any real override of a read-only host getter has to.
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: { getUserMedia: async () => ({ getTracks: () => [] }) },
      });
    }, fakeAudioText);
  }

  async function mockMicPermissionDenied(page: import("@playwright/test").Page) {
    await page.addInitScript(() => {
      class FakeMediaRecorder extends EventTarget {
        state = "inactive";
        start() {}
        stop() {}
      }
      // @ts-expect-error - test-only stub
      window.MediaRecorder = FakeMediaRecorder;
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: {
          getUserMedia: async () => {
            const err = new Error("Permission denied");
            err.name = "NotAllowedError";
            throw err;
          },
        },
      });
    });
  }

  async function mockUnsupportedBrowser(page: import("@playwright/test").Page) {
    await page.addInitScript(() => {
      // @ts-expect-error - simulate a browser with no MediaRecorder support at all
      window.MediaRecorder = undefined;
    });
  }

  /** Press-and-hold the mic button (ARCHITECTURE.md §9/VoiceButton.tsx —
   * push-to-talk is a hold, not a tap-to-toggle): dispatches pointerdown,
   * waits, then pointerup on the same element. */
  async function pressAndHoldMic(page: import("@playwright/test").Page, holdMs = 150) {
    // Matches every aria-label VoiceButton.tsx can show (STATUS_LABEL's
    // values, plus the unsupported-browser label) — not just the "idle"
    // one, since some tests (e.g. mocking away MediaRecorder entirely)
    // need to press it while it's already showing a different label.
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

  test("a full press-and-hold round trip shows the real transcript", async ({ page }) => {
    await mockWorkingMic(page, "add milk to the list");
    await page.goto("/");

    const [uploadResponse] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes("/api/voice/transcribe") && res.request().method() === "POST",
      ),
      pressAndHoldMic(page),
    ]);
    expect(uploadResponse.status()).toBe(200);

    await expect(page.getByText(/Heard: .add milk to the list./)).toBeVisible();
  });

  test("microphone permission denied shows a clear, non-technical message", async ({ page }) => {
    await mockMicPermissionDenied(page);
    await page.goto("/");

    await pressAndHoldMic(page);

    await expect(page.getByText(/microphone access was blocked/i)).toBeVisible();
  });

  test("no MediaRecorder support shows a clear, non-technical message", async ({ page }) => {
    await mockUnsupportedBrowser(page);
    await page.goto("/");

    await pressAndHoldMic(page);

    await expect(page.getByText(/voice input isn.t available on this browser/i)).toBeVisible();
  });

  test("an upload/network failure shows a clear, non-technical message", async ({ page }) => {
    await mockWorkingMic(page, "this upload will fail");
    await page.route("**/api/voice/transcribe", (route) => route.abort("failed"));
    await page.goto("/");

    await pressAndHoldMic(page);

    await expect(page.getByText(/couldn.t reach the server/i)).toBeVisible();
  });
});
