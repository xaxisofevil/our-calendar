import { test, expect } from "@playwright/test";
import { addDaysFromToday, dayCell, dayDetailLabel, selectDay } from "./helpers";

// Runs at tablet width (this project's default, see playwright.config.ts),
// where the day-detail panel is an always-visible side panel — no need to
// deal with the mobile slide-up sheet here; that's covered in
// responsive.spec.ts.

test.describe("Day selection / day-detail panel", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("selecting a day with a seeded event shows it in the day-detail panel", async ({ page }) => {
    // backend/src/db/seed.ts creates a one-off "Dentist" event for Eric,
    // 3 days from now, 3:00pm, 60 minutes.
    const day = addDaysFromToday(3);
    await selectDay(page, day);

    const panel = page.locator('section[aria-label="Selected day"]');
    await expect(panel.getByText("Dentist")).toBeVisible();
    await expect(panel.getByText("1 event")).toBeVisible();
    await expect(panel.getByText("Eric")).toBeVisible();
    await expect(panel.getByText(/Downtown Dental/)).toBeVisible();
    await expect(panel.getByText("3:00 PM")).toBeVisible();
  });

  test("selecting an empty day shows the 'nothing scheduled' empty state", async ({ page }) => {
    // Day 9 is deliberately untouched by every other spec in this suite
    // (see the offset map in README.md) so it's guaranteed to stay empty.
    const day = addDaysFromToday(9);
    await selectDay(page, day);

    const panel = page.locator('section[aria-label="Selected day"]');
    await expect(panel.getByText("Nothing scheduled.")).toBeVisible();
    await expect(panel.getByText("Tap + to add something for this day.")).toBeVisible();
    // The to-do list is a separate, always-visible panel regardless of which
    // day is selected (it's dateless) — sanity check it's still there
    // alongside the empty day-detail panel.
    await expect(page.locator('section[aria-label="Household to-do list"]')).toBeVisible();
  });

  test("selecting a different day updates the panel's date heading", async ({ page }) => {
    const dayA = addDaysFromToday(9);
    const dayB = addDaysFromToday(10);
    await selectDay(page, dayA);
    await expect(page.locator('section[aria-label="Selected day"]')).toContainText(dayDetailLabel(dayA));

    await selectDay(page, dayB);
    await expect(page.locator('section[aria-label="Selected day"]')).toContainText(dayDetailLabel(dayB));
    await expect(page.locator('section[aria-label="Selected day"]')).not.toContainText(dayDetailLabel(dayA));
  });

  test("the clicked day cell is visually marked selected (aria-pressed)", async ({ page }) => {
    const day = addDaysFromToday(9);
    const cell = dayCell(page, day);
    await cell.click();
    await expect(cell).toHaveAttribute("aria-pressed", "true");
  });
});
