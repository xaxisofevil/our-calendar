import { test, expect } from "@playwright/test";

// frontend/index.html hardcodes data-skin="paper-ink" (no picker exists yet
// — that's M2's Settings → Appearance page per ARCHITECTURE.md §4/§14).
// frontend/src/styles/tokens.css defines the Paper & Ink token values,
// light-mode on [data-skin="paper-ink"] and dark-mode overrides under
// `@media (prefers-color-scheme: dark)`.

test.describe("Paper & Ink skin tokens", () => {
  test("<html data-skin=\"paper-ink\"> is present", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-skin", "paper-ink");
  });

  test("light-mode tokens resolve to the documented Paper & Ink values", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    const root = page.locator("html");
    await expect(root).toHaveCSS("--color-bg", "#f3ecdd");
    await expect(root).toHaveCSS("--color-surface", "#fbf7ec");
    await expect(root).toHaveCSS("--color-accent", "#b0512e");
    await expect(root).toHaveCSS("--color-ink", "#2c2318");
  });

  test("dark-mode (prefers-color-scheme) swaps the same tokens to the dark palette", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/");
    const root = page.locator("html");
    await expect(root).toHaveCSS("--color-bg", "#1e1811");
    await expect(root).toHaveCSS("--color-surface", "#2a2118");
    await expect(root).toHaveCSS("--color-accent", "#e07a50");
    await expect(root).toHaveCSS("--color-ink", "#f1e7d3");
  });

  test("the header/day-numeral actually render using the resolved --color-accent token (not a hardcoded color)", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    // "Today" button is styled bg-[var(--color-accent)] in App.tsx.
    const todayButton = page.getByRole("button", { name: "Today" });
    await expect(todayButton).toHaveCSS("background-color", "rgb(176, 81, 46)"); // #b0512e
  });
});
