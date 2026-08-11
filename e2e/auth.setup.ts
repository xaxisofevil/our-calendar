import { test as setup } from "@playwright/test";
import { E2E_AUTH_PASSCODE, E2E_AUTH_STATE_PATH } from "./helpers";

// Playwright "setup project" pattern (see playwright.config.ts's `projects`:
// "setup" runs this file and the "chromium" project depends on it, reusing
// the storageState it writes). Logs in once, against the isolated e2e
// backend, so every other spec file in this suite starts already
// authenticated — this suite exists to exercise the app's features, not
// re-prove the passcode gate in every single spec file. auth.spec.ts is the
// one place that deliberately starts from a blank, unauthenticated context
// instead (via its own `test.use({ storageState: ... })` override) to test
// the gate itself.
setup("authenticate", async ({ page }) => {
  const res = await page.request.post("/api/auth/login", { data: { passcode: E2E_AUTH_PASSCODE } });
  if (!res.ok()) {
    throw new Error(
      `e2e auth setup: login failed (${res.status()}) — is AUTH_PASSCODE wired to the e2e backend in playwright.config.ts's webServer env?`,
    );
  }

  // Pre-seed the one-time "Enable notifications" prompt (App.tsx,
  // ARCHITECTURE.md §8a) as already-dismissed, same as the inline
  // storageState this replaced used to do directly in playwright.config.ts
  // — see that file's history / e2e/README.md for why this matters (it's a
  // real fixed-position element that would otherwise cover the screen on
  // every spec's first-ever page load).
  await page.goto("/");
  await page.evaluate(() => localStorage.setItem("our-calendar:notif-prompt-seen", "1"));

  await page.context().storageState({ path: E2E_AUTH_STATE_PATH });
});
