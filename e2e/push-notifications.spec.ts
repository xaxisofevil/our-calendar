import { test, expect } from "@playwright/test";
import { countPushSubscriptions, countSentReminders, findPushSubscription, waitForSentReminder } from "./db";

// ARCHITECTURE.md §8a/§12/§14 M5 — Web Push. Real delivery to a real device
// can't be verified from an automated suite (see ARCHITECTURE.md's M5
// manual verification checklist); what *is* verified here, against the
// isolated e2e backend (VAPID configured with a throwaway keypair, scan
// interval sped up — see e2e/helpers.ts):
//
//  - the real "Enable notifications" UI flow (mocked browser Notification/
//    Push APIs, real POST /api/push/subscribe call)
//  - POST/DELETE /api/push/subscribe's persistence + validation + upsert +
//    idempotent-delete behavior
//  - the reminder-scan logic (lib/reminders.ts) actually finding a
//    qualifying occurrence and recording it in sent_reminders exactly once
//    (no re-send on the next tick)
//
// push_subscriptions/sent_reminders have no GET endpoint (§12 deliberately
// doesn't expose one), so assertions on their contents read the isolated
// e2e SQLite file directly (e2e/db.ts) — never the real dev/prod database.

test.describe("Push notification subscription API", () => {
  test("subscribing persists a row, re-subscribing the same endpoint upserts rather than duplicating", async ({
    page,
  }) => {
    const endpoint = `https://example.com/fake-endpoint-upsert-${Date.now()}`;

    const first = await page.request.post("/api/push/subscribe", {
      data: { endpoint, keys: { p256dh: "fake-p256dh-key-value", auth: "fake-auth-secret" }, deviceLabel: "Test A" },
    });
    expect(first.status()).toBe(201);
    const firstBody = await first.json();
    expect(firstBody.endpoint).toBe(endpoint);
    expect(firstBody.deviceLabel).toBe("Test A");

    const second = await page.request.post("/api/push/subscribe", {
      data: { endpoint, keys: { p256dh: "rotated-p256dh-key", auth: "rotated-auth" }, deviceLabel: "Test B" },
    });
    expect(second.status()).toBe(201);
    const secondBody = await second.json();
    // Same row (upserted on endpoint), not a new one.
    expect(secondBody.id).toBe(firstBody.id);
    expect(secondBody.deviceLabel).toBe("Test B");

    expect(countPushSubscriptions(endpoint)).toBe(1);
  });

  test("rejects a malformed subscribe body", async ({ page }) => {
    const res = await page.request.post("/api/push/subscribe", {
      data: { endpoint: "https://example.com/missing-keys" },
    });
    expect(res.status()).toBe(400);
  });

  test("unsubscribing removes the row, and is idempotent for an endpoint that's already gone", async ({ page }) => {
    const endpoint = `https://example.com/fake-endpoint-unsub-${Date.now()}`;
    await page.request.post("/api/push/subscribe", {
      data: { endpoint, keys: { p256dh: "fake-p256dh-key-value", auth: "fake-auth-secret" } },
    });
    expect(findPushSubscription(endpoint)).toBeTruthy();

    const del = await page.request.delete("/api/push/subscribe", { data: { endpoint } });
    expect(del.status()).toBe(204);
    expect(findPushSubscription(endpoint)).toBeUndefined();

    // Deleting again (device already uninstalled, or a duplicate tap) is
    // still a success, not a 404 — see actions/push.ts's unsubscribePush.
    const delAgain = await page.request.delete("/api/push/subscribe", { data: { endpoint } });
    expect(delAgain.status()).toBe(204);
  });
});

test.describe("Push reminder scan", () => {
  test("finds an occurrence starting within the lead window, sends, and records it exactly once", async ({
    page,
  }) => {
    const endpoint = `https://example.com/fake-endpoint-scan-${Date.now()}`;
    await page.request.post("/api/push/subscribe", {
      data: { endpoint, keys: { p256dh: "fake-p256dh-key-value", auth: "fake-auth-secret" } },
    });

    // Starts 5 minutes from now — comfortably inside NOTIFICATION_LEAD_MINUTES
    // (30, backend/src/lib/constants.ts) without being so close to "now"
    // that a slow test runner could push it into the past before the first
    // scan tick.
    const startAt = new Date(Date.now() + 5 * 60_000).toISOString();
    const endAtIso = new Date(Date.now() + 35 * 60_000).toISOString();
    const eventRes = await page.request.post("/api/events", {
      data: { title: `Push reminder scan test ${Date.now()}`, startAt, endAt: endAtIso, allDay: false },
    });
    expect(eventRes.status()).toBe(201);
    const event = await eventRes.json();

    // The isolated backend's scan interval is sped up to a few seconds for
    // this suite (E2E_REMINDER_SCAN_INTERVAL_MS, playwright.config.ts) —
    // still async/on-its-own-schedule from this test's perspective, so poll
    // rather than assume a fixed number of ticks have elapsed.
    await waitForSentReminder(event.id, startAt);
    expect(countSentReminders(event.id, startAt)).toBe(1);

    // A second tick (or several) must not re-send/re-record the same
    // occurrence — §8a's whole reason for sent_reminders existing.
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    expect(countSentReminders(event.id, startAt)).toBe(1);

    await page.request.delete("/api/push/subscribe", { data: { endpoint } });
  });

  test("an occurrence outside the lead window is not recorded", async ({ page }) => {
    const startAt = new Date(Date.now() + 90 * 60_000).toISOString(); // 90 min out — outside the 30-min window
    const endAtIso = new Date(Date.now() + 120 * 60_000).toISOString();
    const eventRes = await page.request.post("/api/events", {
      data: { title: `Push reminder scan (out of window) ${Date.now()}`, startAt, endAt: endAtIso, allDay: false },
    });
    const event = await eventRes.json();

    await new Promise((resolve) => setTimeout(resolve, 3_000));
    expect(countSentReminders(event.id, startAt)).toBe(0);
  });
});

test.describe('"Enable notifications" UI flow', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("clicking Enable notifications requests permission, subscribes via the Push API, and posts the subscription", async ({
    page,
  }) => {
    const fakeEndpoint = "https://example.com/fake-endpoint-ui-flow";

    // Mocks the two browser APIs this flow depends on (lib/push.ts) —
    // there's no real push service to subscribe against in a test browser,
    // and no OS permission dialog to click through headlessly. Registered
    // before any page script runs (Playwright guarantee for addInitScript),
    // so it's in place before the app's own code (or this test) ever calls
    // either API.
    await page.addInitScript((endpoint) => {
      // @ts-expect-error - test-only override of a read-only static in real browsers
      window.Notification.requestPermission = async () => "granted";

      const fakeSubscription = {
        endpoint,
        toJSON: () => ({ endpoint, keys: { p256dh: "fake-p256dh-key-value", auth: "fake-auth-secret" } }),
        unsubscribe: async () => true,
      };
      navigator.serviceWorker.ready.then((registration) => {
        // @ts-expect-error - test-only stub, real PushManager isn't reachable headlessly
        registration.pushManager.subscribe = async () => fakeSubscription;
        // @ts-expect-error - same as above
        registration.pushManager.getSubscription = async () => null;
      });
    }, fakeEndpoint);

    await page.goto("/");

    // App.tsx's header "preview" button re-opens the one-time prompt on
    // demand (see App.tsx's previewNotifPrompt) — the default e2e
    // storageState pre-dismisses it (auth.setup.ts), so this is how the
    // test reaches it deliberately rather than relying on first-load timing.
    await page.getByRole("button", { name: /Preview the one-time notifications prompt/i }).click();
    const dialog = page.getByRole("dialog", { name: "Enable notifications" });
    await expect(dialog).toBeVisible();

    const [subscribeResponse] = await Promise.all([
      page.waitForResponse((res) => res.url().includes("/api/push/subscribe") && res.request().method() === "POST"),
      dialog.getByRole("button", { name: "Enable notifications" }).click(),
    ]);

    expect(subscribeResponse.status()).toBe(201);
    const body = await subscribeResponse.json();
    expect(body.endpoint).toBe(fakeEndpoint);
    expect(findPushSubscription(fakeEndpoint)).toBeTruthy();

    await page.request.delete("/api/push/subscribe", { data: { endpoint: fakeEndpoint } });
  });
});
