import { test, expect } from "@playwright/test";
import { monthTitleFor } from "./helpers";

test.describe("Month grid", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("renders the current month by default", async ({ page }) => {
    await expect(page.locator("header > p")).toHaveText(monthTitleFor(new Date()));
  });

  test("shows a 42-cell (6-week) grid with Sun-Sat weekday headers", async ({ page }) => {
    const grid = page.locator('section[aria-label="Month"]');
    const headers = grid.locator("div.grid.grid-cols-7").first().locator("> div");
    await expect(headers).toHaveText(["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"]);

    // Scoped to the day-cells grid specifically (the *last* of the two
    // `div.grid.grid-cols-7` elements — weekday headers is the first) —
    // MonthGrid's own card header (month title, prev/next/Today, expand)
    // now also lives inside `section[aria-label="Month"]` and contributes
    // its own <button>s, so an unscoped grid.getByRole("button") would
    // over-count.
    const dayButtons = grid.locator("div.grid.grid-cols-7").last().getByRole("button");
    await expect(dayButtons).toHaveCount(42);
  });

  test("grid always starts on a Sunday and ends on a Saturday", async ({ page }) => {
    const grid = page.locator('section[aria-label="Month"]');
    const dayButtons = grid.locator("div.grid.grid-cols-7").last().getByRole("button");

    const firstLabel = (await dayButtons.first().getAttribute("aria-label")) ?? "";
    const lastLabel = (await dayButtons.last().getAttribute("aria-label")) ?? "";
    expect(firstLabel.startsWith("Sunday,")).toBe(true);
    expect(lastLabel.startsWith("Saturday,")).toBe(true);
  });

  test("marks exactly one cell as today", async ({ page }) => {
    const grid = page.locator('section[aria-label="Month"]');
    await expect(grid.locator('[aria-current="date"]')).toHaveCount(1);
  });

  test("Next/Previous month navigation updates the title, Today returns to the current month", async ({
    page,
  }) => {
    const title = page.locator("header > p");
    const currentTitle = monthTitleFor(new Date());
    await expect(title).toHaveText(currentTitle);

    await page.getByRole("button", { name: "Next month" }).click();
    const nextMonthDate = new Date();
    nextMonthDate.setMonth(nextMonthDate.getMonth() + 1);
    await expect(title).toHaveText(monthTitleFor(nextMonthDate));

    await page.getByRole("button", { name: "Next month" }).click();
    const monthAfter = new Date();
    monthAfter.setMonth(monthAfter.getMonth() + 2);
    await expect(title).toHaveText(monthTitleFor(monthAfter));

    await page.getByRole("button", { name: "Previous month" }).click();
    await page.getByRole("button", { name: "Previous month" }).click();
    await expect(title).toHaveText(currentTitle);

    // Navigate away again, then confirm "Today" snaps back in one click.
    await page.getByRole("button", { name: "Next month" }).click();
    await page.getByRole("button", { name: "Next month" }).click();
    await page.getByRole("button", { name: "Next month" }).click();
    await page.getByRole("button", { name: "Today" }).click();
    await expect(title).toHaveText(currentTitle);
  });

  test("days outside the current month are visually de-emphasized", async ({ page }) => {
    const grid = page.locator('section[aria-label="Month"]');
    const dayButtons = grid.getByRole("button");
    const first = dayButtons.first();
    const last = dayButtons.last();
    // The grid always shows 42 cells; unless the current month happens to
    // start on a Sunday and take exactly 6 full weeks (rare), the first
    // and/or last cell belongs to an adjacent month and should carry the
    // faded treatment (opacity-55 class from MonthGrid.tsx).
    const firstClass = (await first.getAttribute("class")) ?? "";
    const lastClass = (await last.getAttribute("class")) ?? "";
    const edgesFaded = firstClass.includes("opacity-55") || lastClass.includes("opacity-55");
    expect(edgesFaded).toBe(true);
  });
});
