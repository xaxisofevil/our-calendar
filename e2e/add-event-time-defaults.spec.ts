import { test, expect } from "@playwright/test";
import { openAddEventSheet, selectDay } from "./helpers";

// Direct feedback: the add-event sheet's default start time was a
// hardcoded "3:00 PM" — wrong for half the day, since a default already
// behind the clock reads as a bug. And changing the start time didn't
// nudge the end time along the way Google Calendar's create-flow does.
//
// Uses Playwright's virtual clock (page.clock) for determinism, same
// pattern as imminent-event-pulse.spec.ts. openAddEventSheet only waits
// for the dialog to appear (doesn't return a locator) — get it the same
// way fillEventForm does.
test.describe("Add-event sheet: time defaults and auto-follow", () => {
  test("the default start time is always at or after the current time, never behind it", async ({ page }) => {
    // 2:45pm — the exact case that would have defaulted to a *past* 3:00pm
    // under the old hardcoded default.
    const referenceTime = new Date();
    referenceTime.setHours(14, 45, 0, 0);
    await page.clock.install({ time: referenceTime });

    await page.goto("/");
    await selectDay(page, referenceTime);
    await openAddEventSheet(page);
    const dialog = page.getByRole("dialog", { name: "New event" });

    // Rounds up to the next half-hour: 2:45pm -> 3:00pm.
    await expect(dialog.getByLabel("Starts")).toHaveValue("15:00");
    // Defaults to a 30-minute slot.
    await expect(dialog.getByLabel("Ends")).toHaveValue("15:30");
  });

  test("a start time exactly on a half-hour boundary is left unrounded", async ({ page }) => {
    const referenceTime = new Date();
    referenceTime.setHours(9, 0, 0, 0);
    await page.clock.install({ time: referenceTime });

    await page.goto("/");
    await selectDay(page, referenceTime);
    await openAddEventSheet(page);
    const dialog = page.getByRole("dialog", { name: "New event" });

    await expect(dialog.getByLabel("Starts")).toHaveValue("09:00");
    await expect(dialog.getByLabel("Ends")).toHaveValue("09:30");
  });

  test("changing the start time shifts the end time 30 minutes later, until end time is edited directly", async ({
    page,
  }) => {
    const referenceTime = new Date();
    referenceTime.setHours(10, 0, 0, 0);
    await page.clock.install({ time: referenceTime });

    await page.goto("/");
    await selectDay(page, referenceTime);
    await openAddEventSheet(page);
    const dialog = page.getByRole("dialog", { name: "New event" });

    // Move the start time — end time should follow automatically.
    await dialog.getByLabel("Starts").fill("13:00");
    await expect(dialog.getByLabel("Ends")).toHaveValue("13:30");

    await dialog.getByLabel("Starts").fill("18:15");
    await expect(dialog.getByLabel("Ends")).toHaveValue("18:45");

    // Now touch end time directly — this "locks" it.
    await dialog.getByLabel("Ends").fill("20:00");
    await expect(dialog.getByLabel("Ends")).toHaveValue("20:00");

    // Moving start time again must NOT drag the manually-set end time.
    await dialog.getByLabel("Starts").fill("19:00");
    await expect(dialog.getByLabel("Ends")).toHaveValue("20:00");
  });

  test("the auto-follow lock resets each time the sheet is freshly opened for a new event", async ({ page }) => {
    const referenceTime = new Date();
    referenceTime.setHours(8, 0, 0, 0);
    await page.clock.install({ time: referenceTime });

    await page.goto("/");
    await selectDay(page, referenceTime);

    await openAddEventSheet(page);
    const dialog = page.getByRole("dialog", { name: "New event" });
    await dialog.getByLabel("Ends").fill("12:00"); // lock it
    await dialog.getByRole("button", { name: "Close" }).click();

    await openAddEventSheet(page);
    await dialog.getByLabel("Starts").fill("09:00");
    // A fresh sheet starts unlocked again — end time should follow.
    await expect(dialog.getByLabel("Ends")).toHaveValue("09:30");
  });
});
