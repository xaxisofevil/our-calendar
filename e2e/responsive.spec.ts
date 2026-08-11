import { test, expect } from "@playwright/test";
import { addDaysFromToday, dayCell } from "./helpers";

// ARCHITECTURE.md §4: "Tablet (large landscape screen): month grid +
// day-detail as a side panel, both visible at once." / "iPhone (narrow):
// month grid full-width; tapping a day pushes a full-screen day-detail
// sheet." Same React tree, CSS-breakpoint-driven (Tailwind `md:`, 768px).
//
// Tablet layout (this pass's redesign): Calendar occupies the left half of
// the screen; Day List and To-Do split the right half, top/bottom. Each
// card has its own expand button opening a dismissible modal (see
// PanelExpandButton/ExpandedPanelModal) — the default three-region layout
// itself is unaffected by expanding one of them.
//
// Reserved day offset 0 ("today") for this spec: no other spec's tests
// create/delete events on today, so the day-detail content here stays
// whatever the seed left it (irrelevant — these tests only check panel
// chrome/visibility, not its contents).

test.describe("Responsive layout: tablet (~1280x800)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("Calendar, Day List, and To-Do are all visible at once, without tapping any day", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('section[aria-label="Month"]')).toBeVisible();
    await expect(page.locator('section[aria-label="Selected day"]')).toBeVisible();
    await expect(page.locator('section[aria-label="Household to-do list"]')).toBeVisible();
    // No mobile-only full-screen sheet exists at this width at all (see
    // App.tsx's isTabletUp gating) — not just hidden, not mounted.
    await expect(page.locator("div.z-40")).toHaveCount(0);
  });

  test("Calendar sits in the left half, with Day List and To-Do stacked to its right", async ({ page }) => {
    await page.goto("/");
    const calendarBox = await page.locator('section[aria-label="Month"]').boundingBox();
    const dayListBox = await page.locator('section[aria-label="Selected day"]').boundingBox();
    const todoBox = await page.locator('section[aria-label="Household to-do list"]').boundingBox();
    expect(calendarBox).toBeTruthy();
    expect(dayListBox).toBeTruthy();
    expect(todoBox).toBeTruthy();

    // Day List/To-Do are to the right of Calendar...
    expect(dayListBox!.x).toBeGreaterThan(calendarBox!.x + calendarBox!.width / 2);
    expect(todoBox!.x).toBeGreaterThan(calendarBox!.x + calendarBox!.width / 2);
    // ...and Day List sits above To-Do (top/bottom split of the right half).
    expect(todoBox!.y).toBeGreaterThan(dayListBox!.y);
  });

  test("selecting a day updates the panel in place, no full-screen sheet/backdrop appears", async ({
    page,
  }) => {
    await page.goto("/");
    await dayCell(page, addDaysFromToday(0)).click();
    await expect(page.locator("div.z-40")).toHaveCount(0);
  });

  test("Day List and To-Do each expose an expand button; Calendar does not", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Expand Day List" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Expand To-Do" })).toBeVisible();
    // Calendar already defaults to half the screen — expanding it to the
    // same modal treatment would gain nothing, so it deliberately has no
    // expand affordance at all (direct feedback during this pass).
    await expect(page.getByRole("button", { name: "Expand Calendar" })).toHaveCount(0);
  });

  test("expanding a card opens it in a modal with an explicit collapse control, and collapsing returns to the default layout", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Expand Day List" }).click();

    const dialog = page.getByRole("dialog", { name: "Day List" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Collapse Day List" })).toBeVisible();

    await dialog.getByRole("button", { name: "Collapse Day List" }).click();
    await expect(page.getByRole("dialog", { name: "Day List" })).toHaveCount(0);
    // Back to the default layout — the card's slot instance is showing again.
    await expect(page.getByRole("button", { name: "Expand Day List" })).toBeVisible();
  });

  test("the month title/nav controls live in Calendar's own card header, not a page-wide bar", async ({
    page,
  }) => {
    await page.goto("/");
    // The mobile-only global title+nav block is present but hidden at this
    // width (md:hidden) — getByRole excludes it from the accessibility
    // tree, so this resolves unambiguously to MonthGrid's own card header.
    await expect(page.getByRole("button", { name: "Next month" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Today" })).toBeVisible();
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

  test("no tablet expand buttons render at this width", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Expand Day List" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Expand To-Do" })).toHaveCount(0);
  });
});
