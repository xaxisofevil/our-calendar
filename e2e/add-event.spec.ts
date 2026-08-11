import { test, expect } from "@playwright/test";
import {
  addDaysFromToday,
  dayCell,
  fillEventForm,
  openAddEventSheet,
  saveEventForm,
  selectDay,
} from "./helpers";

test.describe("Add-event flow", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("filling title/time/notes/person and saving shows the event in day-detail and as a month-grid dot", async ({
    page,
  }) => {
    const day = addDaysFromToday(1);
    await selectDay(page, day);

    await openAddEventSheet(page);
    await fillEventForm(page, {
      title: "Piano lesson",
      person: "Lindsay",
      startTime: "14:00",
      endTime: "14:45",
      notes: "Bring the blue folder",
    });
    await saveEventForm(page);

    const panel = page.locator('section[aria-label="Selected day"]');
    await expect(panel.getByText("Piano lesson")).toBeVisible();
    await expect(panel.getByText("Lindsay")).toBeVisible();
    await expect(panel.getByText("2:00 PM")).toBeVisible();
    await expect(panel.getByText("Bring the blue folder")).toBeVisible();

    // Month grid: the day cell now has an event dot, reflected in its
    // aria-label (MonthGrid.tsx builds this from live event count/names).
    const cell = dayCell(page, day);
    await expect(cell).toHaveAttribute("aria-label", /1 event \(Lindsay\)/);
  });

  test("the sheet defaults to the first seeded person (Eric) when none is explicitly picked", async ({
    page,
  }) => {
    const day = addDaysFromToday(1);
    await selectDay(page, day);
    await openAddEventSheet(page);
    await fillEventForm(page, { title: "Unpicked person event" });
    await saveEventForm(page);

    await expect(page.locator('section[aria-label="Selected day"]').getByText("Eric")).toBeVisible();
  });

  test("the All-day toggle hides the start/end time fields, and the saved event shows 'All day'", async ({
    page,
  }) => {
    const day = addDaysFromToday(2);
    await selectDay(page, day);
    await openAddEventSheet(page);

    const dialog = page.getByRole("dialog", { name: "New event" });
    await expect(dialog.getByLabel("Starts")).toBeVisible();
    await expect(dialog.getByLabel("Ends")).toBeVisible();

    await fillEventForm(page, { title: "Field trip", allDay: true });

    // Fields should be fully removed from the DOM, not just visually hidden.
    await expect(dialog.locator('input[type="time"]')).toHaveCount(0);

    await saveEventForm(page);
    const panel = page.locator('section[aria-label="Selected day"]');
    await expect(panel.getByText("Field trip")).toBeVisible();
    await expect(panel.getByText("All day")).toBeVisible();
  });

  test("toggling All-day back off restores the time fields", async ({ page }) => {
    const day = addDaysFromToday(2);
    await selectDay(page, day);
    await openAddEventSheet(page);
    const dialog = page.getByRole("dialog", { name: "New event" });

    await dialog.getByRole("checkbox", { name: "All day" }).check();
    await expect(dialog.locator('input[type="time"]')).toHaveCount(0);
    await dialog.getByRole("checkbox", { name: "All day" }).uncheck();
    await expect(dialog.locator('input[type="time"]')).toHaveCount(2);
  });

  test("Cancel discards the draft without creating an event", async ({ page }) => {
    const day = addDaysFromToday(2);
    await selectDay(page, day);
    await openAddEventSheet(page);
    await fillEventForm(page, { title: "Should not be saved" });
    await page.getByRole("dialog", { name: "New event" }).getByRole("button", { name: "Cancel" }).click();

    // The sheet stays mounted (never unmounted, just transitioned off-screen
    // and to opacity 0) — toBeHidden() would pass vacuously since it never
    // hits display:none, so check the actual closed-state style instead.
    await expect(page.getByRole("dialog", { name: "New event" })).toHaveCSS("opacity", "0");
    await expect(
      page.locator('section[aria-label="Selected day"]').getByText("Should not be saved"),
    ).toHaveCount(0);
  });

  test("an invalid time range (end before start) is auto-corrected rather than saved broken", async ({
    page,
  }) => {
    const day = addDaysFromToday(2);
    await selectDay(page, day);
    await openAddEventSheet(page);
    await fillEventForm(page, { title: "Backwards time", startTime: "10:00", endTime: "09:00" });
    await saveEventForm(page);

    // AddEventSheet.tsx bumps endAt to startAt+1h when end <= start, so the
    // event should exist and show its (corrected) start time, not silently
    // fail or produce a negative-duration event.
    const panel = page.locator('section[aria-label="Selected day"]');
    await expect(panel.getByText("Backwards time")).toBeVisible();
    await expect(panel.getByText("10:00 AM")).toBeVisible();
  });

  test.describe("adversarial: blank title", () => {
    test("a blank title is rejected, not silently saved as an untitled event", async ({ page }) => {
      const day = addDaysFromToday(4);
      await selectDay(page, day);
      await openAddEventSheet(page);
      // Deliberately leave the title field empty.
      await saveEventForm(page);

      const panel = page.locator('section[aria-label="Selected day"]');
      // KNOWN BUG (see QA report): AddEventSheet.tsx's handleSave() does
      // `title.trim() || "Untitled event"` and calls onSave unconditionally,
      // so today a blank title silently creates an event titled "Untitled
      // event" instead of being rejected — no validation error is ever
      // shown, and the sheet closes as if the save succeeded. This
      // assertion encodes the *intended* behavior (reject, don't
      // fabricate a title) and will fail until that's fixed.
      await expect(panel.getByText("Untitled event")).toHaveCount(0);
      await expect(panel.getByText("Nothing scheduled.")).toBeVisible();
    });
  });

  test.describe("adversarial: overlong title", () => {
    test("a title over the backend's 200-char limit does not silently vanish", async ({ page }) => {
      const day = addDaysFromToday(5);
      await selectDay(page, day);
      await openAddEventSheet(page);
      const longTitle = "X".repeat(250);
      await fillEventForm(page, { title: longTitle });
      await saveEventForm(page);

      // FIXED (was the QA report's bug #2): backend/src/lib/validation.ts
      // caps event titles at 200 chars and correctly 400s a 250-char title;
      // App.tsx's onSave now only closes the sheet on the mutation's
      // onSuccess (see lib/queries.ts / lib/errors.ts), so on a rejected
      // save the sheet stays open with its error banner visible instead of
      // closing as if it worked — that's a clearer place for the user to
      // see (and fix) the problem than a page-level toast would be.
      const dialog = page.getByRole("dialog", { name: "New event" });
      await expect(dialog).toHaveCSS("opacity", "1");
      await expect(dialog.getByText(/too long/i)).toBeVisible();

      // Confirms the other half of the bug report: the event really is
      // absent, not just hidden from view.
      const panel = page.locator('section[aria-label="Selected day"]');
      await expect(panel.getByText(longTitle)).toHaveCount(0);
    });
  });

  test("special characters and markup in the title render as literal text, not executed markup", async ({
    page,
  }) => {
    const day = addDaysFromToday(14);
    await selectDay(page, day);
    await openAddEventSheet(page);
    const spicyTitle = `<script>window.__xss=true</script> "quoted" & <b>bold</b>`;
    await fillEventForm(page, { title: spicyTitle });
    await saveEventForm(page);

    const panel = page.locator('section[aria-label="Selected day"]');
    await expect(panel.getByText(spicyTitle)).toBeVisible();
    const xssRan = await page.evaluate(() => (window as unknown as { __xss?: boolean }).__xss);
    expect(xssRan).toBeUndefined();
  });

  test("rapid double-click on Save: records whether it creates a duplicate row", async ({ page }) => {
    const day = addDaysFromToday(13);
    await selectDay(page, day);
    await openAddEventSheet(page);
    await fillEventForm(page, { title: "Double submit test" });
    const saveButton = page.getByRole("dialog", { name: "New event" }).getByRole("button", { name: "Save" });
    // Fire two rapid clicks the way an impatient/uncertain tap on a fridge
    // tablet plausibly would. Dispatched synchronously in-page (rather than
    // two separate Playwright .click() calls racing each other through
    // actionability/animation) so both land before the first click's
    // onSave() has a chance to close/transition the sheet out from under
    // the second one. No debounce/guard exists in AddEventSheet/App.tsx
    // today, so this is expected to (and does) create two rows — logged as
    // an observation, not failed on, since nothing in ARCHITECTURE.md
    // mandates submit idempotency.
    await saveButton.evaluate((btn: HTMLElement) => {
      btn.click();
      btn.click();
    });

    const panel = page.locator('section[aria-label="Selected day"]');
    await expect(panel.getByText("Double submit test").first()).toBeVisible();
    const matchCount = await panel.getByText("Double submit test").count();
    test.info().annotations.push({
      type: "observation",
      description: `Rapid double-click on Save produced ${matchCount} event row(s) titled "Double submit test" (no submit-guard exists in the app today).`,
    });
  });
});
