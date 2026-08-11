import { test, expect } from "@playwright/test";
import { addDaysFromToday, dayCell, fillEventForm, openAddEventSheet, saveEventForm, selectDay, swipeRowOpen } from "./helpers";

// SSE live-sync (ARCHITECTURE.md §3/§12/§14 M2): GET /api/stream broadcasts
// "events:changed" / "todos:changed", and every *other* connected client
// invalidates its TanStack Query cache and refetches — this is what fixes
// "I had to manually refresh to see what she added." These tests open a
// second page in the same browser context (simulating a second device
// talking to the same backend) and assert the second page picks up a
// change made on the first WITHOUT ever calling page2.reload() — that's
// the whole point of the mechanism.
test.describe("Live sync (SSE)", () => {
  test("an event created on one client appears on another client's month grid and day-detail without a reload", async ({
    page,
    context,
  }) => {
    const page1 = page;
    const page2 = await context.newPage();
    await page1.goto("/");
    await page2.goto("/");

    const day = addDaysFromToday(20);
    await selectDay(page1, day);
    await openAddEventSheet(page1);
    await fillEventForm(page1, { title: "Synced piano recital", person: "Damien" });
    await saveEventForm(page1);

    const panel1 = page1.locator('section[aria-label="Selected day"]');
    await expect(panel1.getByText("Synced piano recital")).toBeVisible();

    // page2 never reloads and never navigates — its month grid dot should
    // update on its own once the SSE broadcast invalidates its events
    // query and it refetches.
    const cell2 = dayCell(page2, day);
    await expect(cell2).toHaveAttribute("aria-label", /1 event \(Damien\)/, { timeout: 10_000 });

    await selectDay(page2, day);
    const panel2 = page2.locator('section[aria-label="Selected day"]');
    await expect(panel2.getByText("Synced piano recital")).toBeVisible();

    await page2.close();
  });

  test("a todo added on one client appears on another client's list without a reload", async ({ page, context }) => {
    const page1 = page;
    const page2 = await context.newPage();
    await page1.goto("/");
    await page2.goto("/");

    const text = `Synced todo ${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const input1 = page1.getByLabel("Add a to-do item");
    await input1.fill(text);
    await page1.getByRole("button", { name: "Add item", exact: true }).click();

    await expect(page1.getByRole("checkbox", { name: text, exact: true })).toBeVisible();
    // No reload/interaction on page2 at all — purely SSE-driven.
    await expect(page2.getByRole("checkbox", { name: text, exact: true })).toBeVisible({ timeout: 10_000 });

    await page2.close();
  });

  test("deleting an event on one client removes it from another client's view without a reload", async ({
    page,
    context,
  }) => {
    const page1 = page;
    const page2 = await context.newPage();
    await page1.goto("/");
    await page2.goto("/");

    const day = addDaysFromToday(21);
    await selectDay(page1, day);
    await openAddEventSheet(page1);
    await fillEventForm(page1, { title: "Synced then deleted" });
    await saveEventForm(page1);

    await selectDay(page2, day);
    const panel2 = page2.locator('section[aria-label="Selected day"]');
    await expect(panel2.getByText("Synced then deleted")).toBeVisible({ timeout: 10_000 });

    const panel1 = page1.locator('section[aria-label="Selected day"]');
    await swipeRowOpen(page1, panel1.locator("li", { hasText: "Synced then deleted" }));
    await panel1.getByRole("button", { name: "Delete Synced then deleted" }).click();
    await expect(panel1.getByText("Synced then deleted")).toHaveCount(0);

    await expect(panel2.getByText("Synced then deleted")).toHaveCount(0, { timeout: 10_000 });

    await page2.close();
  });
});
