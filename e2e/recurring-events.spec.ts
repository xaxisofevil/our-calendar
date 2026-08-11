import { test, expect } from "@playwright/test";
import {
  addDaysFromToday,
  dayDetailLabel,
  fillEventForm,
  openAddEventSheet,
  saveEventForm,
  selectDay,
  selectRepeatOption,
  toDateInputValue,
} from "./helpers";

// Recurring events (ARCHITECTURE.md §7a): a single "master" row with an
// RFC 5545 `recurrence_rule`, expanded into occurrences at read time by
// GET /api/events?start=...&end=... (backend/src/lib/recurrence.ts, using
// the `rrule` package). Correctness of the expansion itself is checked here
// via the real API (a wide date range), which sidesteps the month-grid's
// 42-cell viewport — whether a given future occurrence is inside the
// *currently rendered* grid depends on which day of the month "today"
// happens to be on the day this suite runs, so asserting through the API
// keeps these tests deterministic regardless of run date. The initial
// create/edit/delete actions themselves still go through the real UI.
test.describe("Recurring events", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("a weekly recurring event expands into multiple correctly-spaced occurrences", async ({ page, request }) => {
    const anchor = addDaysFromToday(15);
    await selectDay(page, anchor);
    await openAddEventSheet(page);
    await fillEventForm(page, { title: "Guitar lesson", startTime: "16:00", endTime: "16:30" });
    await selectRepeatOption(page, /^Weekly on/);
    await saveEventForm(page);

    // Confirm the master occurrence itself landed on the UI first.
    const panel = page.locator('section[aria-label="Selected day"]');
    await expect(panel.getByText("Guitar lesson")).toBeVisible();

    // Then verify the expansion directly via the API over a 60-day window —
    // a weekly rule with no end condition should produce ~8-9 occurrences,
    // each exactly 7 days apart, all titled identically (same master row).
    const rangeStart = addDaysFromToday(0);
    const rangeEnd = addDaysFromToday(60);
    const toDateParam = toDateInputValue;
    const res = await request.get(
      `/api/events?start=${toDateParam(rangeStart)}&end=${toDateParam(rangeEnd)}`,
    );
    expect(res.ok()).toBe(true);
    const events = (await res.json()) as Array<{ title: string; startAt: string; recurrenceRule: string | null }>;
    const occurrences = events
      .filter((e) => e.title === "Guitar lesson")
      .sort((a, b) => a.startAt.localeCompare(b.startAt));

    expect(occurrences.length).toBeGreaterThanOrEqual(6);
    for (const occ of occurrences) {
      expect(occ.recurrenceRule).toMatch(/^FREQ=WEEKLY/);
    }
    // Every consecutive pair is exactly 7 days apart.
    for (let i = 1; i < occurrences.length; i++) {
      const deltaMs = new Date(occurrences[i].startAt).getTime() - new Date(occurrences[i - 1].startAt).getTime();
      expect(deltaMs).toBe(7 * 24 * 60 * 60 * 1000);
    }
  });

  test("editing a recurring event changes the whole series, not just one occurrence", async ({ page, request }) => {
    const anchor = addDaysFromToday(16);
    await selectDay(page, anchor);
    await openAddEventSheet(page);
    await fillEventForm(page, { title: "Book club" });
    await selectRepeatOption(page, /^Weekly on/);
    await saveEventForm(page);

    // Edit via the UI: tap the occurrence on its anchor day, rename it.
    await selectDay(page, anchor);
    const panel = page.locator('section[aria-label="Selected day"]');
    await panel.getByText("Book club").click();
    const editDialog = page.getByRole("dialog", { name: "Edit event" });
    await editDialog.getByPlaceholder("e.g. Piano lesson").fill("Book club (moved)");
    await editDialog.getByRole("button", { name: "Save changes" }).click();

    const toDateParam = toDateInputValue;
    const res = await request.get(
      `/api/events?start=${toDateParam(addDaysFromToday(0))}&end=${toDateParam(addDaysFromToday(45))}`,
    );
    const events = (await res.json()) as Array<{ title: string; startAt: string }>;
    const renamed = events.filter((e) => e.title === "Book club (moved)");
    const stale = events.filter((e) => e.title === "Book club");

    // The whole series should reflect the new title (v1 scope: no
    // per-occurrence exceptions — see ARCHITECTURE.md §7a) — a later
    // occurrence a couple weeks out should also be renamed, and none of the
    // old title should remain.
    expect(renamed.length).toBeGreaterThanOrEqual(3);
    expect(stale.length).toBe(0);
  });

  test("deleting a recurring event removes the whole series", async ({ page, request }) => {
    const anchor = addDaysFromToday(17);
    await selectDay(page, anchor);
    await openAddEventSheet(page);
    await fillEventForm(page, { title: "Trash day reminder" });
    await selectRepeatOption(page, /^Weekly on/);
    await saveEventForm(page);

    await selectDay(page, anchor);
    const panel = page.locator('section[aria-label="Selected day"]');
    await panel.getByRole("button", { name: "Delete Trash day reminder" }).click();
    await expect(panel.getByText("Trash day reminder")).toHaveCount(0);

    const toDateParam = toDateInputValue;
    const res = await request.get(
      `/api/events?start=${toDateParam(addDaysFromToday(0))}&end=${toDateParam(addDaysFromToday(45))}`,
    );
    const events = (await res.json()) as Array<{ title: string }>;
    expect(events.filter((e) => e.title === "Trash day reminder").length).toBe(0);
  });

  test("editing a recurring event pre-fills the Repeats field with its actual pattern", async ({ page }) => {
    const anchor = addDaysFromToday(18);
    await selectDay(page, anchor);
    await openAddEventSheet(page);
    await fillEventForm(page, { title: "Standing meeting" });
    await selectRepeatOption(page, /^Weekly on/);
    await saveEventForm(page);

    await selectDay(page, anchor);
    const panel = page.locator('section[aria-label="Selected day"]');
    await panel.getByText("Standing meeting").click();
    const editDialog = page.getByRole("dialog", { name: "Edit event" });
    // Should show the real "Weekly on <Weekday>" summary, not reset to the
    // default "Does not repeat".
    await expect(editDialog.locator('button[aria-haspopup="listbox"]')).toHaveText(/^Weekly on/);

    // Sanity: the date field still reflects the anchor day (regression
    // check for the effectiveDate wiring the Repeats field relies on).
    await expect(editDialog.getByText(dayDetailLabel(anchor))).toBeVisible();
  });

  test("a plain (non-recurring) event still defaults to 'Does not repeat' and produces exactly one occurrence", async ({
    page,
    request,
  }) => {
    const anchor = addDaysFromToday(19);
    await selectDay(page, anchor);
    await openAddEventSheet(page);
    const dialog = page.getByRole("dialog", { name: "New event" });
    await expect(dialog.locator('button[aria-haspopup="listbox"]')).toHaveText("Does not repeat");
    await fillEventForm(page, { title: "One-off checkup" });
    await saveEventForm(page);

    const toDateParam = toDateInputValue;
    const res = await request.get(
      `/api/events?start=${toDateParam(addDaysFromToday(0))}&end=${toDateParam(addDaysFromToday(45))}`,
    );
    const events = (await res.json()) as Array<{ title: string; recurrenceRule: string | null }>;
    const matches = events.filter((e) => e.title === "One-off checkup");
    expect(matches.length).toBe(1);
    expect(matches[0].recurrenceRule).toBeNull();
  });
});
