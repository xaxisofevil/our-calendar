import { test, expect } from "@playwright/test";
import { addDaysFromToday, dayCell, fillEventForm, openAddEventSheet, saveEventForm, selectDay } from "./helpers";

test.describe("Delete event", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("deleting an event removes it from both the day-detail panel and the month-grid dot", async ({
    page,
  }) => {
    const day = addDaysFromToday(6);
    await selectDay(page, day);
    await openAddEventSheet(page);
    await fillEventForm(page, { title: "Vet appointment", person: "Damien" });
    await saveEventForm(page);

    const panel = page.locator('section[aria-label="Selected day"]');
    await expect(panel.getByText("Vet appointment")).toBeVisible();
    const cell = dayCell(page, day);
    await expect(cell).toHaveAttribute("aria-label", /1 event/);

    await panel.getByRole("button", { name: "Delete Vet appointment" }).click();

    await expect(panel.getByText("Vet appointment")).toHaveCount(0);
    await expect(panel.getByText("Nothing scheduled.")).toBeVisible();
    await expect(cell).toHaveAttribute("aria-label", /nothing scheduled/);
  });

  test("deleting one of two events on the same day leaves the other intact", async ({ page }) => {
    const day = addDaysFromToday(6);
    await selectDay(page, day);

    await openAddEventSheet(page);
    await fillEventForm(page, { title: "Keep me" });
    await saveEventForm(page);

    await openAddEventSheet(page);
    await fillEventForm(page, { title: "Delete me" });
    await saveEventForm(page);

    const panel = page.locator('section[aria-label="Selected day"]');
    await expect(panel.getByText("Keep me")).toBeVisible();
    await expect(panel.getByText("Delete me")).toBeVisible();

    await panel.getByRole("button", { name: "Delete Delete me" }).click();

    await expect(panel.getByText("Delete me")).toHaveCount(0);
    await expect(panel.getByText("Keep me")).toBeVisible();
  });
});
