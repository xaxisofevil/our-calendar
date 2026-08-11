import {
  addDays,
  addMonths,
  format,
  isSameDay,
  isSameMonth,
  isToday as dfIsToday,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";

export const WEEKDAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

/** 42-cell (6-week) grid for the month containing `monthAnchor`, always
 * starting on a Sunday, matching the validated mockup's grid shape. */
export function getMonthGridDays(monthAnchor: Date): Date[] {
  const gridStart = startOfWeek(startOfMonth(monthAnchor));
  return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
}

export function nextMonth(monthAnchor: Date): Date {
  return addMonths(monthAnchor, 1);
}

export function previousMonth(monthAnchor: Date): Date {
  return subMonths(monthAnchor, 1);
}

export function monthTitle(monthAnchor: Date): string {
  return format(monthAnchor, "MMMM yyyy");
}

/** Local (browser-timezone) yyyy-MM-dd key — used both as a map key for
 * grouping fetched events onto grid cells and as the `start`/`end` query
 * params sent to GET /api/events. */
export function dateKey(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

export function dayDetailLabel(date: Date): string {
  return format(date, "EEEE, MMM d");
}

export function isToday(date: Date): boolean {
  return dfIsToday(date);
}

export { isSameDay, isSameMonth };

export function gridRange(monthAnchor: Date): { start: string; end: string } {
  const days = getMonthGridDays(monthAnchor);
  return { start: dateKey(days[0]), end: dateKey(days[days.length - 1]) };
}

/** Which occurrence of its weekday `date` is within its month (1-5) — the
 * "third" in "monthly on the third Thursday". */
export function nthWeekdayOfMonth(date: Date): number {
  return Math.ceil(date.getDate() / 7);
}

/** True if `date` is the last time its weekday occurs in its month —
 * Google Calendar's picker says "last" instead of e.g. "fifth" there. */
export function isLastWeekdayOfMonth(date: Date): boolean {
  return addDays(date, 7).getMonth() !== date.getMonth();
}

const ORDINALS = ["first", "second", "third", "fourth", "fifth"];

export function ordinalWeekdayLabel(date: Date): string {
  if (isLastWeekdayOfMonth(date)) return "last";
  return ORDINALS[nthWeekdayOfMonth(date) - 1] ?? "last";
}
