import { test, expect } from "@playwright/test";
import { addTodoWithDueDate, toDateInputValue, todoRow } from "./helpers";

// Todo due dates (ARCHITECTURE.md §8/§11, `todos.due_at`) — real persistence
// now, not the old mock `Map` state in App.tsx. Todos are dateless/global
// (§8), so — like add-todo.spec.ts — these isolate with unique-per-run text
// rather than day offsets.
function uniqueText(label: string): string {
  return `${label} ${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

function daysFromToday(n: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return d;
}

test.describe("Todo due dates", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("a due date set via quick-add persists across a reload (real column, not local mock state)", async ({
    page,
  }) => {
    const text = uniqueText("Pay property tax");
    const dueDate = toDateInputValue(daysFromToday(5));
    await addTodoWithDueDate(page, text, dueDate);

    const list = page.locator('section[aria-label="Household to-do list"]');
    await expect(todoRow(page, text)).toBeVisible();
    await expect(list.getByText(/^Due /)).toBeVisible();

    // The old implementation kept due dates in an in-memory Map in App.tsx
    // (lost on refresh, by design of that mock). A real `due_at` column
    // should survive a full reload.
    await page.reload();
    const row = todoRow(page, text);
    await expect(row).toBeVisible();
    const li = page.locator("li", { has: row });
    await expect(li.getByText(/^Due /)).toBeVisible();
  });

  test("an incomplete overdue todo sorts above non-overdue incomplete items and is labeled overdue", async ({
    page,
  }) => {
    // Deliberately avoid the word "overdue" in the todo text itself — the
    // assertions below look for that word in the item's row, and the text
    // itself lives in that same row (as the item's label), so a todo text
    // containing it would create a false-positive match.
    const overdueText = uniqueText("Library fine");
    const notDueText = uniqueText("Someday: clean garage");
    const yesterday = toDateInputValue(daysFromToday(-1));

    // Add the not-yet-due item first, then the overdue one — if sorting
    // didn't move the overdue item to the top, insertion order alone would
    // put the not-due item first, so this ordering actually exercises the
    // sort (ARCHITECTURE.md §8: "incomplete overdue items float to the
    // top... most-overdue first").
    await addTodoWithDueDate(page, notDueText, toDateInputValue(daysFromToday(30)));
    await addTodoWithDueDate(page, overdueText, yesterday);

    const list = page.locator('section[aria-label="Household to-do list"]');
    await expect(todoRow(page, overdueText)).toBeVisible();
    await expect(todoRow(page, notDueText)).toBeVisible();

    const labelsInOrder = await list.getByRole("checkbox").evaluateAll((nodes) => nodes.map((n) => n.getAttribute("aria-label")));
    const overdueIndex = labelsInOrder.indexOf(overdueText);
    const notDueIndex = labelsInOrder.indexOf(notDueText);
    expect(overdueIndex).toBeGreaterThanOrEqual(0);
    expect(overdueIndex).toBeLessThan(notDueIndex);

    // Visible "overdue" label near the overdue item only.
    const overdueLi = page.locator("li", { has: todoRow(page, overdueText) });
    const notDueLi = page.locator("li", { has: todoRow(page, notDueText) });
    await expect(overdueLi.getByText(/· overdue/)).toBeVisible();
    await expect(notDueLi.getByText(/· overdue/)).toHaveCount(0);
  });

  test("completing an overdue todo removes it from the overdue-sort-to-top treatment", async ({ page }) => {
    const text = uniqueText("Overdue then completed");
    await addTodoWithDueDate(page, text, toDateInputValue(daysFromToday(-3)));

    const row = todoRow(page, text);
    const li = page.locator("li", { has: row });
    await expect(li.getByText(/· overdue/)).toBeVisible();

    await row.click();
    await expect(row).toHaveAttribute("aria-checked", "true");
    // Completed items are explicitly unaffected by due-date sorting/labeling
    // (ARCHITECTURE.md §8) — the "overdue" qualifier only ever applies to
    // "an incomplete todo with due_at in the past".
    await expect(li.getByText(/· overdue/)).toHaveCount(0);
  });

  test("adding a todo without a due date still works (due date stays optional)", async ({ page }) => {
    const text = uniqueText("No due date item");
    await page.getByLabel("Add a to-do item").click();
    const dialog = page.getByRole("dialog", { name: "Add a to-do item" });
    await dialog.getByLabel("Add a to-do item").fill(text);
    await dialog.getByRole("button", { name: /^(Add item|Send)$/ }).click();
    await page.keyboard.press("Escape");
    await expect(todoRow(page, text)).toBeVisible();
    const li = page.locator("li", { has: todoRow(page, text) });
    await expect(li.getByText(/^Due /)).toHaveCount(0);
  });
});
