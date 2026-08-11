import { test, expect } from "@playwright/test";
import { E2E_AUTH_PASSCODE } from "./helpers";

// ARCHITECTURE.md §5/§12, M5/M6 — the device-session passcode gate. Every
// other spec file in this suite runs pre-authenticated (see
// playwright.config.ts's "setup" project / e2e/auth.setup.ts); this file is
// the one place that deliberately starts from a blank, unauthenticated
// browser context instead, to test the gate itself.
test.describe("auth", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("wrong passcode shows an error and does not grant access", async ({ page }) => {
    await page.goto("/");
    const passcodeInput = page.getByLabel("Passcode");
    await expect(passcodeInput).toBeVisible();

    await passcodeInput.fill("definitely-the-wrong-passcode");
    await page.getByRole("button", { name: "Unlock" }).click();

    await expect(page.getByText("That passcode didn't work. Try again.")).toBeVisible();
    // Still gated: the real app's chrome never mounted.
    await expect(passcodeInput).toBeVisible();
    await expect(page.getByLabel("Add a to-do item")).toHaveCount(0);

    // Editing the field again clears the error state (matches
    // AddEventSheet's titleError pattern this component reuses).
    await passcodeInput.fill("t");
    await expect(page.getByText("That passcode didn't work. Try again.")).toHaveCount(0);
  });

  test("correct passcode grants access and the app loads normally", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Passcode").fill(E2E_AUTH_PASSCODE);
    await page.getByRole("button", { name: "Unlock" }).click();

    await expect(page.getByLabel("Passcode")).toHaveCount(0);
    // The real app is up: to-do panel and month grid both present.
    await expect(page.getByLabel("Add a to-do item")).toBeVisible();
  });

  test("a valid session cookie persists across a reload (no re-prompt)", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Passcode").fill(E2E_AUTH_PASSCODE);
    await page.getByRole("button", { name: "Unlock" }).click();
    await expect(page.getByLabel("Add a to-do item")).toBeVisible();

    await page.reload();

    await expect(page.getByLabel("Passcode")).toHaveCount(0);
    await expect(page.getByLabel("Add a to-do item")).toBeVisible();
  });

  test("missing or invalid session cookie on a protected route returns 401", async ({ request }) => {
    // Missing cookie — this context's storageState is blank (see test.use
    // above), so `request` (which shares that storageState) has none.
    const missing = await request.get("/api/events?start=2026-01-01&end=2026-01-02");
    expect(missing.status()).toBe(401);

    // Invalid cookie — well-formed but never issued by a real login, so no
    // device_sessions row hashes to it. Same rejection path an expired
    // session (deleted server-side once past its ~1-year age, see
    // backend/src/lib/auth.ts's findSessionByToken) falls into once its row
    // is gone — both are "no matching, non-expired session found".
    const invalid = await request.get("/api/events?start=2026-01-01&end=2026-01-02", {
      headers: { Cookie: "our_calendar_session=0000000000000000000000000000000000000000000000000000000000000000" },
    });
    expect(invalid.status()).toBe(401);

    // Health and login themselves must stay reachable without a session —
    // the two documented exceptions (ARCHITECTURE.md §12).
    const health = await request.get("/api/health");
    expect(health.status()).toBe(200);
  });
});
