import { test, expect, type Locator, type Page } from "@playwright/test";
import { addDaysFromToday, dayCell, dayDetailLabel, dayGridLabel } from "./helpers";

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

// Mobile default view (this pass — approved "Week Strip + Agenda" mockup
// direction, ARCHITECTURE.md M2 UX pass): replaces the old "full month grid
// on load, tap a day to push a full-screen sheet" behavior with a 7-day
// chip strip + a permanent inline agenda card below it, and the full month
// grid moved behind a collapsed-by-default "Full month" toggle. See
// frontend/src/components/{WeekStrip,MobileWeekCard}.tsx.
//
// Day-offset convention (README.md): offset 0 is reserved for this spec and
// never mutated. Everything below either reads offset 0/3/9 (seeded/never-
// written fixtures, per README.md) or navigates/reads without creating any
// event, so nothing here needs its own reserved offset.
test.describe("Responsive layout: iPhone (~390x844)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  /** A button locator matching a day's aria-label prefix (shared by
   * WeekStrip's chips and MonthGrid's cells — same `EEEE, MMMM d` format),
   * scoped to `within` so a date visible in both the strip and an expanded
   * grid at once never resolves ambiguously. */
  function dayButton(within: Page | Locator, date: Date) {
    return within.getByRole("button", { name: new RegExp(`^${dayGridLabel(date).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) });
  }

  /** A day within the same Sun-Sat week as today, guaranteed to already be
   * one of the 7 chips the strip renders by default (it only ever shows
   * *today's* week) — unlike a fixed offset, which could land in a
   * different week depending on what day of the week "today" actually is. */
  function sameWeekOtherDay(): Date {
    const today = addDaysFromToday(0);
    const delta = today.getDay() === 6 ? -1 : 1; // Saturday has no "+1" in-week day
    const d = new Date(today);
    d.setDate(d.getDate() + delta);
    return d;
  }

  test("default view: week strip + permanent agenda are visible, today selected, full month collapsed", async ({
    page,
  }) => {
    await page.goto("/");

    const strip = page.locator('section[aria-label="This week"]');
    await expect(strip).toBeVisible();

    const today = addDaysFromToday(0);
    const todayChip = dayButton(strip, today);
    await expect(todayChip).toHaveAttribute("aria-current", "date");
    await expect(todayChip).toHaveAttribute("aria-pressed", "true");

    // Agenda is a permanent card, not a hidden/fixed-position sheet — no
    // full-screen overlay wrapper exists at all on this view anymore.
    await expect(page.locator("div.z-40")).toHaveCount(0);
    const agenda = page.locator('section[aria-label="Selected day"]');
    await expect(agenda).toBeVisible();
    await expect(agenda).toContainText(dayDetailLabel(today));

    // Full month starts collapsed — MonthGrid isn't even mounted yet.
    await expect(page.locator('section[aria-label="Month"]')).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Full month" })).toBeVisible();

    // To-do list stays visible in the new flow too.
    await expect(page.locator('section[aria-label="Household to-do list"]')).toBeVisible();
  });

  test("tapping a different chip updates the agenda in place, no navigation/sheet", async ({ page }) => {
    await page.goto("/");
    const strip = page.locator('section[aria-label="This week"]');
    const other = sameWeekOtherDay();
    const otherChip = dayButton(strip, other);

    await otherChip.click();

    await expect(otherChip).toHaveAttribute("aria-pressed", "true");
    const agenda = page.locator('section[aria-label="Selected day"]');
    await expect(agenda).toContainText(dayDetailLabel(other));
    await expect(page.locator("div.z-40")).toHaveCount(0);
  });

  test("Full month expands the real month grid inline, with its own nav", async ({ page }) => {
    await page.goto("/");
    const toggle = page.getByRole("button", { name: "Full month" });
    await toggle.click();

    const grid = page.locator('section[aria-label="Month"]');
    await expect(grid).toBeVisible();
    await expect(page.getByRole("button", { name: "Hide full month" })).toBeVisible();
    // MonthGrid's own header (title + prev/next/Today) now renders here too
    // (mobile no longer has a page-wide duplicate — see App.tsx).
    await expect(grid.getByRole("button", { name: "Next month" })).toBeVisible();
    await expect(grid.getByRole("button", { name: "Today" })).toBeVisible();

    // And it collapses again on a second tap, without picking a day.
    await page.getByRole("button", { name: "Hide full month" }).click();
    await expect(grid).toHaveCount(0);
  });

  test("picking a day inside the expanded month grid updates the strip/agenda and collapses the grid back", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Full month" }).click();

    // Day 9: seeded/never-written fixture (README.md) — also exercises a
    // pick that (for most "today"s) falls outside the currently-displayed
    // week, proving the grid pick isn't limited to the strip's own week.
    const target = addDaysFromToday(9);
    const grid = page.locator('section[aria-label="Month"]');
    await dayButton(grid, target).click();

    // Grid collapses back down automatically after the pick (matches the
    // approved mockup's interaction).
    await expect(page.locator('section[aria-label="Month"]')).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Full month" })).toBeVisible();

    // Strip and agenda both now reflect the newly-picked day.
    const strip = page.locator('section[aria-label="This week"]');
    await expect(dayButton(strip, target)).toHaveAttribute("aria-pressed", "true");
    const agenda = page.locator('section[aria-label="Selected day"]');
    await expect(agenda).toContainText(dayDetailLabel(target));
  });

  test("the agenda reuses the real Day List: seeded event, empty state, and add-event all work", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Full month" }).click();
    const grid = page.locator('section[aria-label="Month"]');
    const agenda = page.locator('section[aria-label="Selected day"]');

    // backend/src/db/seed.ts's "Dentist" event, 3 days out (same fixture
    // day-detail.spec.ts's tablet coverage reads).
    await dayButton(grid, addDaysFromToday(3)).click();
    await expect(agenda.getByText("Dentist")).toBeVisible();

    // Grid auto-collapsed after that pick — re-expand for the next one.
    await page.getByRole("button", { name: "Full month" }).click();
    await dayButton(grid, addDaysFromToday(9)).click();
    await expect(agenda.getByText("Nothing scheduled.")).toBeVisible();

    await agenda.getByRole("button", { name: "Add event for the selected day" }).click();
    await expect(page.getByRole("dialog", { name: "New event" })).toBeVisible();
  });

  test("no tablet expand buttons render at this width", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Expand Day List" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Expand To-Do" })).toHaveCount(0);
  });
});
