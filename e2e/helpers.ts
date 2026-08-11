import type { Page } from "@playwright/test";

/**
 * The 4 seeded household members and their fixed colors, straight from
 * backend/src/db/seed.ts. If seed.ts ever changes these, update here too —
 * deliberately not derived programmatically so a drift between the two is a
 * loud test failure, not a silently-passing tautology.
 */
export const SEEDED_PEOPLE = [
  { label: "Eric", color: "#5B8CA6" },
  { label: "Lindsay", color: "#A85A82" },
  { label: "Gavin", color: "#C08A2E" },
  { label: "Damien", color: "#6B5CA5" },
] as const;

/** Converts a "#RRGGBB" hex string to the "rgb(r, g, b)" form the browser
 * normalizes computed/inline colors to, so tests can compare directly
 * against getComputedStyle()/style.backgroundColor output. */
export function hexToRgb(hex: string): string {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgb(${r}, ${g}, ${b})`;
}

/** Mirrors frontend/src/lib/dateUtils.ts#dayDetailLabel's date-fns
 * `format(date, "EEEE, MMM d")` (abbreviated month) using plain Intl so
 * tests don't need a date-fns dependency of their own. Used by the
 * day-detail panel heading and the AddEventSheet's read-only "Date" field. */
export function dayDetailLabel(date: Date): string {
  const weekday = date.toLocaleDateString("en-US", { weekday: "long" });
  const month = date.toLocaleDateString("en-US", { month: "short" });
  return `${weekday}, ${month} ${date.getDate()}`;
}

/** Matches MonthGrid's per-cell aria-label prefix, which inlines its own
 * `format(day, "EEEE, MMMM d")` call — full month name, NOT the same
 * abbreviated format dayDetailLabel above uses. These two really do differ
 * in the app today (dateUtils.ts's shared helper vs. MonthGrid.tsx's
 * inline call); do not fold them back into one helper. */
export function dayGridLabel(date: Date): string {
  const weekday = date.toLocaleDateString("en-US", { weekday: "long" });
  const month = date.toLocaleDateString("en-US", { month: "long" });
  return `${weekday}, ${month} ${date.getDate()}`;
}

export function addDaysFromToday(n: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return d;
}

export function monthTitleFor(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

/** Escapes regex metacharacters so a computed label can be used as a
 * RegExp source safely (day labels contain no metacharacters today, but
 * this keeps the helper honest if that ever changes). */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Locates a month-grid day cell by date, tolerant of the event-count/
 * person-list suffix MonthGrid appends to the aria-label. */
export function dayCell(page: Page, date: Date) {
  const label = dayGridLabel(date);
  return page.getByRole("button", { name: new RegExp(`^${escapeRegExp(label)}`) });
}

/** Clicks a given day's grid cell, then waits for the day-detail panel
 * (side panel on tablet width, slide-up sheet on mobile) to reflect that
 * date, so callers don't race the panel's transition. */
export async function selectDay(page: Page, date: Date) {
  await dayCell(page, date).click();
  await page.locator('section[aria-label="Selected day"]').getByText(dayDetailLabel(date)).waitFor();
}

interface EventFormInput {
  title?: string;
  notes?: string;
  allDay?: boolean;
  startTime?: string;
  endTime?: string;
  person?: (typeof SEEDED_PEOPLE)[number]["label"];
}

/** Opens the add-event sheet (day-detail's "+" button must already be
 * visible/reachable — call selectDay first on mobile width), fills the
 * requested fields, and clicks Save. Leaves title/time fields at their
 * defaults if not specified. */
export async function openAddEventSheet(page: Page) {
  await page.getByRole("button", { name: "Add event for the selected day" }).click();
  await page.getByRole("dialog", { name: "New event" }).waitFor();
}

export async function fillEventForm(page: Page, input: EventFormInput) {
  const dialog = page.getByRole("dialog", { name: "New event" });
  if (input.title !== undefined) {
    await dialog.getByPlaceholder("e.g. Piano lesson").fill(input.title);
  }
  if (input.person) {
    await dialog.getByRole("button", { name: input.person, exact: true }).click();
  }
  if (input.allDay) {
    await dialog.getByRole("checkbox", { name: "All day" }).check();
  }
  if (input.startTime) {
    await dialog.getByLabel("Starts").fill(input.startTime);
  }
  if (input.endTime) {
    await dialog.getByLabel("Ends").fill(input.endTime);
  }
  if (input.notes !== undefined) {
    await dialog.getByPlaceholder(/leave by 2:30/).fill(input.notes);
  }
}

export async function saveEventForm(page: Page) {
  await page.getByRole("dialog", { name: "New event" }).getByRole("button", { name: "Save" }).click();
}

export async function addTodo(page: Page, text: string, notes?: string) {
  const input = page.getByLabel("Add a to-do item");
  await input.fill(text);
  if (notes) {
    await page.getByRole("button", { name: "+ add details" }).click();
    await page.getByPlaceholder("Notes…").fill(notes);
  }
  await page.getByRole("button", { name: "Add item", exact: true }).click();
}

export function todoRow(page: Page, text: string) {
  return page.getByRole("checkbox", { name: text, exact: true });
}
