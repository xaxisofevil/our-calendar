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
