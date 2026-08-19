import { test, expect } from "@playwright/test";
import { addTodo, swipeRowOpen, todoRow } from "./helpers";

// Coverage for this pass's tablet (md+) redesign: swipe-to-reveal
// Edit/Delete on event and todo rows (replacing the old always-visible
// delete X), the new todo edit flow, and the consolidated hide-completed
// control. Runs at this project's default tablet viewport
// (playwright.config.ts, 1280x800).
function uniqueText(label: string): string {
  return `${label} ${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

test.describe("Swipe-to-reveal: to-do rows", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("Delete is not reachable until the row is swiped open", async ({ page }) => {
    const text = uniqueText("Swipe reveal target");
    await addTodo(page, text);
    const row = todoRow(page, text);
    await expect(row).toBeVisible();

    // Before swiping, the Edit/Delete buttons aren't in the accessibility
    // tree at all (translated fully behind the visible row content).
    await expect(page.getByRole("button", { name: `Delete ${text}` })).toHaveCount(0);

    await swipeRowOpen(page, page.locator("li", { has: row }));
    await expect(page.getByRole("button", { name: `Delete ${text}` })).toBeVisible();
  });

  test("swiping one row open closes a previously-open row", async ({ page }) => {
    const textA = uniqueText("Row A");
    const textB = uniqueText("Row B");
    await addTodo(page, textA);
    await addTodo(page, textB);

    await swipeRowOpen(page, page.locator("li", { has: todoRow(page, textA) }));
    await expect(page.getByRole("button", { name: `Delete ${textA}` })).toBeVisible();

    await swipeRowOpen(page, page.locator("li", { has: todoRow(page, textB) }));
    await expect(page.getByRole("button", { name: `Delete ${textB}` })).toBeVisible();
    await expect(page.getByRole("button", { name: `Delete ${textA}` })).toHaveCount(0);
  });

  test("the revealed Edit button opens an inline edit form pre-filled with the todo's current text, and saves changes", async ({
    page,
  }) => {
    const text = uniqueText("Edit me");
    const newText = uniqueText("Edited text");
    await addTodo(page, text, "original notes");
    const row = todoRow(page, text);

    await swipeRowOpen(page, page.locator("li", { has: row }));
    await page.getByRole("button", { name: `Edit ${text}` }).click();

    const textField = page.getByLabel(`Edit text for ${text}`);
    await expect(textField).toHaveValue(text);
    await expect(page.getByLabel(`Edit notes for ${text}`)).toHaveValue("original notes");

    await textField.fill(newText);
    await page.getByRole("button", { name: `Save changes to ${text}` }).click();

    await expect(todoRow(page, newText)).toBeVisible();
    await expect(todoRow(page, text)).toHaveCount(0);
  });

  test("tapping elsewhere in the list closes an open reveal without deleting anything", async ({ page }) => {
    const text = uniqueText("Dismiss via outside tap");
    await addTodo(page, text);
    const row = todoRow(page, text);

    await swipeRowOpen(page, page.locator("li", { has: row }));
    await expect(page.getByRole("button", { name: `Delete ${text}` })).toBeVisible();

    // Tap the to-do list's own heading — well outside any row.
    await page.locator('section[aria-label="Household to-do list"]').getByText("To-Do", { exact: true }).click();
    await expect(page.getByRole("button", { name: `Delete ${text}` })).toHaveCount(0);
    await expect(row).toBeVisible();
  });
});

test.describe("Consolidated hide-completed control", () => {
  test("one control toggles between 'Hide completed' and 'N completed hidden — show'", async ({ page }) => {
    await page.goto("/");
    const list = page.locator('section[aria-label="Household to-do list"]');
    const toggle = list.getByRole("button", { name: /Hide completed|completed hidden — show/ });
    await expect(toggle).toHaveText("Hide completed");
    // No separate switch input exists anymore alongside it.
    await expect(list.locator("input.toggle-switch")).toHaveCount(0);

    await toggle.click();
    await expect(list.getByRole("button", { name: /completed hidden — show/ })).toBeVisible();

    await list.getByRole("button", { name: /completed hidden — show/ }).click();
    await expect(toggle).toHaveText("Hide completed");
  });
});

test.describe("Tablet card expand/collapse", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("Escape closes an expanded card's modal", async ({ page }) => {
    await page.getByRole("button", { name: "Expand To-Do" }).click();
    await expect(page.getByRole("dialog", { name: "To-Do" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "To-Do" })).toHaveCount(0);
  });

  test("clicking the backdrop closes an expanded card's modal", async ({ page }) => {
    await page.getByRole("button", { name: "Expand Day List" }).click();
    const dialog = page.getByRole("dialog", { name: "Day List" });
    await expect(dialog).toBeVisible();
    // Click well outside the dialog panel itself, inside the backdrop.
    await page.mouse.click(10, 10);
    await expect(dialog).toHaveCount(0);
  });

  test("Calendar has no expand affordance (already defaults to half the screen)", async ({ page }) => {
    await expect(page.getByRole("button", { name: "Expand Calendar" })).toHaveCount(0);
  });

  test("collapsing one card and expanding another leaves only the new one open", async ({ page }) => {
    await page.getByRole("button", { name: "Expand Day List" }).click();
    const dayListDialog = page.getByRole("dialog", { name: "Day List" });
    await expect(dayListDialog).toBeVisible();

    await dayListDialog.getByRole("button", { name: "Collapse Day List" }).click();
    await expect(dayListDialog).toHaveCount(0);

    await page.getByRole("button", { name: "Expand To-Do" }).click();
    await expect(page.getByRole("dialog", { name: "To-Do" })).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Day List" })).toHaveCount(0);
  });
});
