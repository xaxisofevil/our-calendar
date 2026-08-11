import { test, expect } from "@playwright/test";
import { addTodo, todoRow } from "./helpers";

// Todos are dateless/global (ARCHITECTURE.md §8), so unlike events these
// tests can't isolate themselves onto a particular day — each uses a
// unique-per-run text string instead so assertions never collide with
// seeded rows, other spec files, or re-runs against a lingering DB.
function uniqueText(label: string): string {
  return `${label} ${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

test.describe("Add-todo flow", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("adding text + optional notes shows the item in the list", async ({ page }) => {
    const text = uniqueText("Buy stamps");
    await addTodo(page, text, "For the school forms");

    const row = todoRow(page, text);
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute("aria-checked", "false");

    // Notes are collapsed behind a "show notes" toggle by default.
    const list = page.locator('section[aria-label="Household to-do list"]');
    const noteToggle = list.getByRole("button", { name: "Show notes" }).last();
    await noteToggle.click();
    await expect(list.getByText("For the school forms")).toBeVisible();
  });

  test("adding text without notes still works (notes are optional)", async ({ page }) => {
    const text = uniqueText("Refill bird feeder");
    await addTodo(page, text);
    await expect(todoRow(page, text)).toBeVisible();
  });

  test("blank text is not added as an empty item", async ({ page }) => {
    const list = page.locator('section[aria-label="Household to-do list"]');
    const before = await list.getByRole("checkbox").count();

    const input = page.getByLabel("Add a to-do item");
    await input.fill("   ");
    await page.getByRole("button", { name: "Add item", exact: true }).click();

    const after = await list.getByRole("checkbox").count();
    expect(after).toBe(before);
  });

  test("toggling a to-do marks it complete and shows a strikethrough", async ({ page }) => {
    const text = uniqueText("Water the plants");
    await addTodo(page, text);
    const row = todoRow(page, text);

    await row.click();
    await expect(row).toHaveAttribute("aria-checked", "true");

    await row.click();
    await expect(row).toHaveAttribute("aria-checked", "false");
  });

  test("deleting a to-do removes it from the list", async ({ page }) => {
    const text = uniqueText("Return library books");
    await addTodo(page, text);
    const row = todoRow(page, text);
    await expect(row).toBeVisible();

    await page.getByRole("button", { name: `Delete ${text}` }).click();
    await expect(row).toHaveCount(0);
  });

  test("Enter key submits the same as clicking Add", async ({ page }) => {
    const text = uniqueText("Enter-key item");
    const input = page.getByLabel("Add a to-do item");
    await input.fill(text);
    await input.press("Enter");
    await expect(todoRow(page, text)).toBeVisible();
  });

  test.describe("adversarial: overlong text", () => {
    test("text over the backend's 500-char limit does not silently vanish", async ({ page }) => {
      const longText = "Y".repeat(600);
      const input = page.getByLabel("Add a to-do item");
      await input.fill(longText);
      await page.getByRole("button", { name: "Add item", exact: true }).click();

      // KNOWN BUG (see QA report): TodoList.submit() clears the input and
      // App.tsx's onAdd fires createTodo.mutate() with no onError/onSuccess
      // gating — so when backend/src/lib/validation.ts's 500-char cap
      // correctly 400s this, the input is cleared as if it worked and the
      // todo silently never appears, with no error shown to the user. This
      // asserts the desired behavior (item present, or a visible error)
      // and will fail until mutation failures are surfaced.
      const appeared = await page
        .getByRole("checkbox", { name: longText, exact: true })
        .isVisible()
        .catch(() => false);
      const errorShown = await page
        .getByText(/too long|error|failed/i)
        .first()
        .isVisible()
        .catch(() => false);
      expect(appeared || errorShown).toBe(true);
    });
  });

  test("special characters render as literal text, not executed markup", async ({ page }) => {
    const text = uniqueText(`<img src=x onerror="window.__todoXss=true"> "quoted" & <b>bold</b>`);
    await addTodo(page, text);
    await expect(todoRow(page, text)).toBeVisible();
    const xssRan = await page.evaluate(() => (window as unknown as { __todoXss?: boolean }).__todoXss);
    expect(xssRan).toBeUndefined();
  });
});
