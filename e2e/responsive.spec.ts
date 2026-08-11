import { test, expect } from "@playwright/test";
import { addDaysFromToday, dayCell } from "./helpers";

// ARCHITECTURE.md §4: "Tablet (large landscape screen): month grid +
// day-detail as a side panel, both visible at once." / "iPhone (narrow):
// month grid full-width; tapping a day pushes a full-screen day-detail
// sheet." Same React tree, CSS-breakpoint-driven (Tailwind `md:`, 768px).
//
// Reserved day offset 0 ("today") for this spec: no other spec's tests
// create/delete events on today, so the day-detail content here stays
// whatever the seed left it (irrelevant — these tests only check panel
// chrome/visibility, not its contents).

test.describe("Responsive layout: tablet (~1280x800)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("day-detail panel is visible immediately, without tapping any day", async ({ page }) => {
    await page.goto("/");
    const wrapper = page.locator("div.z-40");
    await expect(wrapper).toHaveCSS("position", "static");
    await expect(wrapper).toHaveCSS("opacity", "1");
    await expect(page.locator('section[aria-label="Selected day"]')).toBeVisible();
    // Month grid and day-detail are both on-screen at once (side by side).
    await expect(page.locator('section[aria-label="Month"]')).toBeVisible();
  });

  test("selecting a day updates the panel in place, no full-screen sheet/backdrop appears", async ({
    page,
  }) => {
    await page.goto("/");
    await dayCell(page, addDaysFromToday(0)).click();
    const wrapper = page.locator("div.z-40");
    await expect(wrapper).toHaveCSS("position", "static");
    // No mobile-only "Close" button should be present/visible at this width.
    // Scoped to the day-detail wrapper (div.z-40) — AddEventSheet's own
    // dismiss "×" button is *also* aria-label="Close" but lives in an
    // unrelated top-level overlay, so an unscoped locator here is
    // ambiguous (strict-mode violation), not a real app issue.
    await expect(page.locator("div.z-40").getByRole("button", { name: "Close" })).toBeHidden();
  });
});

test.describe("Responsive layout: iPhone (~390x844)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("day-detail is hidden on load and appears as a full-screen sheet after tapping a day", async ({
    page,
  }) => {
    await page.goto("/");
    const wrapper = page.locator("div.z-40");

    await expect(wrapper).toHaveCSS("position", "fixed");
    await expect(wrapper).toHaveCSS("opacity", "0");
    await expect(wrapper).toHaveCSS("pointer-events", "none");

    await dayCell(page, addDaysFromToday(0)).click();

    await expect(wrapper).toHaveCSS("opacity", "1");
    await expect(wrapper).not.toHaveCSS("pointer-events", "none");
    await expect(page.locator('section[aria-label="Selected day"]')).toBeVisible();
    // Mobile-only close affordance should now be reachable (scoped to
    // div.z-40 — see the tablet test above for why an unscoped locator is
    // ambiguous here).
    await expect(page.locator("div.z-40").getByRole("button", { name: "Close" })).toBeVisible();
  });

  test("the Close button dismisses the sheet again", async ({ page }) => {
    await page.goto("/");
    await dayCell(page, addDaysFromToday(0)).click();
    const wrapper = page.locator("div.z-40");
    await expect(wrapper).toHaveCSS("opacity", "1");

    await page.locator("div.z-40").getByRole("button", { name: "Close" }).click();
    await expect(wrapper).toHaveCSS("opacity", "0");
  });

  test("the month grid remains full-width and usable behind the closed sheet", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('section[aria-label="Month"]')).toBeVisible();
    const box = await page.locator('section[aria-label="Month"]').boundingBox();
    expect(box?.width).toBeGreaterThan(300); // comfortably fills a 390px-wide viewport
  });
});
