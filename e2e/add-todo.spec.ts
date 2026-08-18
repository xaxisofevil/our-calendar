import { test, expect } from "@playwright/test";
import { addTodo, swipeRowOpen, todoRow } from "./helpers";

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
    // Wait for the initial todos fetch to land before counting — "Milk" is
    // one of seed.ts's fixed rows and is never deleted by any spec in this
    // suite, so it's a reliable "list has actually loaded" signal. Without
    // this, `count()` (unlike `expect(...)`, it doesn't retry) can catch
    // the list mid-fetch, when it's still empty.
    await todoRow(page, "Milk").waitFor();
    const before = await list.getByRole("checkbox").count();

    await page.getByLabel("Add a to-do item").click();
    const dialog = page.getByRole("dialog", { name: "Add a to-do item" });
    await dialog.getByLabel("Add a to-do item").fill("   ");
    await dialog.getByRole("button", { name: "Add item", exact: true }).click();
    await page.keyboard.press("Escape");

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

    // Delete now lives behind a swipe-right reveal (SwipeRevealRow), not an
    // always-visible button — swipe the row open first.
    await swipeRowOpen(page, page.locator("li", { has: row }));
    await page.getByRole("button", { name: `Delete ${text}` }).click();
    await expect(row).toHaveCount(0);
  });

  test("Enter key submits the same as clicking Add", async ({ page }) => {
    const text = uniqueText("Enter-key item");
    await page.getByLabel("Add a to-do item").click();
    const dialog = page.getByRole("dialog", { name: "Add a to-do item" });
    const input = dialog.getByLabel("Add a to-do item");
    await input.fill(text);
    // Real <form onSubmit> now (see TodoList.tsx's own comment) — a native
    // Enter keypress on an <input> inside a <form> triggers submission at
    // the browser level, independent of any onKeyDown/e.key detection.
    await input.press("Enter");
    await page.keyboard.press("Escape");
    await expect(todoRow(page, text)).toBeVisible();
  });

  test.describe("adversarial: overlong text", () => {
    test("text over the backend's 500-char limit does not silently vanish", async ({ page }) => {
      const longText = "Y".repeat(600);
      await page.getByLabel("Add a to-do item").click();
      const dialog = page.getByRole("dialog", { name: "Add a to-do item" });
      // Modal deliberately left open here (not closed via Escape like the
      // other tests) — the error message this test checks for only renders
      // inside the modal (see TodoList.tsx), and the real UI leaves the
      // modal open after a submit attempt anyway (see its own "stays open"
      // comment), so this matches what a real user would actually see.
      await dialog.getByLabel("Add a to-do item").fill(longText);
      await dialog.getByRole("button", { name: /^(Add item|Send)$/ }).click();

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
