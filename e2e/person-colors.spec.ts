import { test, expect, type APIRequestContext } from "@playwright/test";
import { SEEDED_PEOPLE, addDaysFromToday, dayCell, fillEventForm, hexToRgb, openAddEventSheet, saveEventForm, selectDay } from "./helpers";

async function dotColors(page: import("@playwright/test").Page, day: Date) {
  const cell = dayCell(page, day);
  const dots = cell.locator('span[aria-hidden="true"] > span');
  const count = await dots.count();
  const colors: string[] = [];
  for (let i = 0; i < count; i++) {
    colors.push(await dots.nth(i).evaluate((el) => getComputedStyle(el).backgroundColor));
  }
  return colors;
}

test.describe("Person color-coding", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("the seeded Dentist (Eric) and Soccer practice (Gavin) events use their people's fixed colors", async ({
    page,
  }) => {
    const eric = SEEDED_PEOPLE.find((p) => p.label === "Eric")!;
    const gavin = SEEDED_PEOPLE.find((p) => p.label === "Gavin")!;

    const dentistDay = addDaysFromToday(3);
    await selectDay(page, dentistDay);
    const dentistDot = page
      .locator('section[aria-label="Selected day"] li')
      .filter({ hasText: "Dentist" })
      .locator("span")
      .first();
    await expect(dentistDot).toHaveCSS("background-color", hexToRgb(eric.color));

    const soccerDay = addDaysFromToday(11);
    await selectDay(page, soccerDay);
    const soccerDot = page
      .locator('section[aria-label="Selected day"] li')
      .filter({ hasText: "Soccer practice" })
      .locator("span")
      .first();
    await expect(soccerDot).toHaveCSS("background-color", hexToRgb(gavin.color));
  });

  test("2 people with events on the same day produce 2 deduplicated, correctly colored month-grid dots", async ({
    page,
  }) => {
    const day = addDaysFromToday(7);
    const eric = SEEDED_PEOPLE.find((p) => p.label === "Eric")!;
    const lindsay = SEEDED_PEOPLE.find((p) => p.label === "Lindsay")!;

    await selectDay(page, day);
    await openAddEventSheet(page);
    await fillEventForm(page, { title: "Color test — Eric A", person: "Eric" });
    await saveEventForm(page);

    await openAddEventSheet(page);
    await fillEventForm(page, { title: "Color test — Lindsay A", person: "Lindsay" });
    await saveEventForm(page);

    let colors = await dotColors(page, day);
    expect(colors.sort()).toEqual([hexToRgb(eric.color), hexToRgb(lindsay.color)].sort());

    // A second event from a person who already has a dot must NOT add a
    // second dot for that same person (dedup, not "one dot per event").
    await openAddEventSheet(page);
    await fillEventForm(page, { title: "Color test — Eric B", person: "Eric" });
    await saveEventForm(page);

    colors = await dotColors(page, day);
    expect(colors.length).toBe(2);
    expect(colors.sort()).toEqual([hexToRgb(eric.color), hexToRgb(lindsay.color)].sort());

    // Adding a 3rd distinct person grows the dot count to 3, with the
    // correct 3rd color.
    const gavin = SEEDED_PEOPLE.find((p) => p.label === "Gavin")!;
    await openAddEventSheet(page);
    await fillEventForm(page, { title: "Color test — Gavin A", person: "Gavin" });
    await saveEventForm(page);

    colors = await dotColors(page, day);
    expect(colors.length).toBe(3);
    expect(colors.sort()).toEqual([hexToRgb(eric.color), hexToRgb(lindsay.color), hexToRgb(gavin.color)].sort());

    // Day-detail should show all 4 events created above, each with its own
    // person's correct accent color on its list-item dot.
    const panel = page.locator('section[aria-label="Selected day"]');
    await expect(panel.getByText("Color test — Eric A")).toBeVisible();
    await expect(panel.getByText("Color test — Eric B")).toBeVisible();
    await expect(panel.getByText("Color test — Lindsay A")).toBeVisible();
    await expect(panel.getByText("Color test — Gavin A")).toBeVisible();
    await expect(panel.getByText("4 events")).toBeVisible();
  });

  test("an event created with no assigned person still renders a (neutral) dot, not a crash", async ({
    page,
    request,
  }: {
    page: import("@playwright/test").Page;
    request: APIRequestContext;
  }) => {
    const day = addDaysFromToday(12);
    const startAt = new Date(day);
    startAt.setHours(9, 0, 0, 0);
    const endAt = new Date(startAt.getTime() + 30 * 60_000);

    // Created directly through the API (rather than the UI, which always
    // defaults to a real person and has no "no one" option) to exercise
    // the personId === null path MonthGrid.tsx explicitly accounts for.
    const res = await request.post("/api/events", {
      data: {
        title: "Unassigned event",
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        allDay: false,
        personId: null,
      },
    });
    expect(res.ok()).toBe(true);

    await page.goto("/");
    const cell = dayCell(page, day);
    await expect(cell).toHaveAttribute("aria-label", /1 event \(unassigned\)/);
    const dots = cell.locator('span[aria-hidden="true"] > span');
    await expect(dots).toHaveCount(1);
  });
});
