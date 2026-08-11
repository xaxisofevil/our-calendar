import { format } from "date-fns";
import { ordinalWeekdayLabel } from "./dateUtils";

// M2 UI-only mock: this models the shape ARCHITECTURE.md §7a describes
// (RFC 5545 RRULE, stored as one string on the master event) closely enough
// to preview the interaction, but nothing here is sent to the backend yet —
// `events` has no `recurrence_rule` column and no route accepts one. This
// module exists purely to drive the AddEventSheet's "Repeats" field for
// approval before that persistence work happens.

export type RepeatFreq = "none" | "daily" | "weekly" | "monthly" | "annually" | "weekday" | "custom";
export type CustomUnit = "day" | "week" | "month" | "year";

export type EndCondition = { type: "never" } | { type: "on"; date: string } | { type: "after"; count: number };

export interface CustomRepeat {
  interval: number;
  unit: CustomUnit;
  weekdays: number[]; // 0 = Sunday .. 6 = Saturday, used when unit === "week"
  end: EndCondition;
}

export interface RepeatValue {
  freq: RepeatFreq;
  custom: CustomRepeat;
}

export const WEEKDAY_SHORT_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

export function defaultCustomRepeat(anchor: Date): CustomRepeat {
  return {
    interval: 1,
    unit: "week",
    weekdays: [anchor.getDay()],
    end: { type: "never" },
  };
}

export function defaultRepeatValue(anchor: Date): RepeatValue {
  return { freq: "none", custom: defaultCustomRepeat(anchor) };
}

export interface RepeatOption {
  value: RepeatFreq;
  label: string;
}

/** The standard Google Calendar quick-pick set, with labels computed
 * relative to whichever day is currently selected — matches ARCHITECTURE.md
 * §7a's required option list exactly. */
export function repeatQuickOptions(anchor: Date): RepeatOption[] {
  const weekday = format(anchor, "EEEE");
  const ordinal = ordinalWeekdayLabel(anchor);
  return [
    { value: "none", label: "Does not repeat" },
    { value: "daily", label: "Daily" },
    { value: "weekly", label: `Weekly on ${weekday}` },
    { value: "monthly", label: `Monthly on the ${ordinal} ${weekday}` },
    { value: "annually", label: `Annually on ${format(anchor, "MMMM d")}` },
    { value: "weekday", label: "Every weekday (Monday to Friday)" },
    { value: "custom", label: "Custom…" },
  ];
}

/** Presentational summary shown on the closed field once something other
 * than "Does not repeat" is chosen — mirrors what Google shows after a
 * custom rule is set, e.g. "Every 2 weeks on Mon, Wed, until Dec 31". */
export function summarizeRepeat(value: RepeatValue, anchor: Date): string {
  if (value.freq !== "custom") {
    return repeatQuickOptions(anchor).find((o) => o.value === value.freq)?.label ?? "Does not repeat";
  }
  const { interval, unit, weekdays, end } = value.custom;
  let text = `Every ${interval} ${unit}${interval === 1 ? "" : "s"}`;
  if (unit === "week" && weekdays.length > 0) {
    const sorted = [...weekdays].sort((a, b) => a - b);
    text += ` on ${sorted.map((d) => WEEKDAY_SHORT_LABELS[d]).join(", ")}`;
  }
  if (end.type === "on" && end.date) text += `, until ${end.date}`;
  if (end.type === "after") text += `, ${end.count} time${end.count === 1 ? "" : "s"}`;
  return text;
}
