import { format } from "date-fns";
import { RRule } from "rrule";
import { isLastWeekdayOfMonth, nthWeekdayOfMonth, ordinalWeekdayLabel } from "./dateUtils";

// Drives the AddEventSheet's "Repeats" field (ARCHITECTURE.md §7a) and
// converts between that UI-friendly shape and the RFC 5545 RRULE text
// actually stored on `events.recurrence_rule` — see ruleFromRepeatValue /
// repeatValueFromRule below, added once the field was wired to real
// persistence (was UI-only mock state before that).

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

// JS Date#getDay() (0=Sunday..6=Saturday) -> the matching rrule Weekday
// constant. rrule's own internal numbering is 0=Monday..6=Sunday, but its
// `Weekday` constants (RRule.SU/.MO/...) and `.getJsWeekday()` method both
// speak JS's convention, so callers here never have to hand-convert.
const RRULE_WEEKDAYS = [RRule.SU, RRule.MO, RRule.TU, RRule.WE, RRule.TH, RRule.FR, RRule.SA];

function stripRulePrefix(rule: InstanceType<typeof RRule>): string {
  // RRule#toString() always prepends "RRULE:" (and "DTSTART:...\n" if a
  // dtstart was set, which we deliberately never pass here — the event's
  // own start_at column IS the dtstart, see ARCHITECTURE.md §7a).
  return rule.toString().replace(/^RRULE:/, "");
}

/** Builds the bare RRULE text to persist on `events.recurrence_rule` from
 * the AddEventSheet's Repeats field state, anchored to the event's own
 * start date/time. Returns null for "Does not repeat" (no column value). */
export function ruleFromRepeatValue(value: RepeatValue, anchor: Date): string | null {
  const anchorWeekday = RRULE_WEEKDAYS[anchor.getDay()];

  switch (value.freq) {
    case "none":
      return null;
    case "daily":
      return stripRulePrefix(new RRule({ freq: RRule.DAILY }));
    case "weekly":
      return stripRulePrefix(new RRule({ freq: RRule.WEEKLY, byweekday: [anchorWeekday] }));
    case "monthly": {
      const nth = isLastWeekdayOfMonth(anchor) ? -1 : nthWeekdayOfMonth(anchor);
      return stripRulePrefix(new RRule({ freq: RRule.MONTHLY, byweekday: [anchorWeekday.nth(nth)] }));
    }
    case "annually":
      // No BYMONTH/BYMONTHDAY needed — per RFC 5545, a YEARLY rule with
      // neither specified defaults to dtstart's own month/day.
      return stripRulePrefix(new RRule({ freq: RRule.YEARLY }));
    case "weekday":
      return stripRulePrefix(
        new RRule({ freq: RRule.WEEKLY, byweekday: [RRule.MO, RRule.TU, RRule.WE, RRule.TH, RRule.FR] }),
      );
    case "custom": {
      const { interval, unit, weekdays, end } = value.custom;
      const freq =
        unit === "day" ? RRule.DAILY : unit === "week" ? RRule.WEEKLY : unit === "month" ? RRule.MONTHLY : RRule.YEARLY;
      const options: ConstructorParameters<typeof RRule>[0] = { freq, interval };
      if (unit === "week") {
        const selected = weekdays.length > 0 ? weekdays : [anchor.getDay()];
        options.byweekday = selected.map((day) => RRULE_WEEKDAYS[day]);
      }
      if (end.type === "on" && end.date) {
        options.until = new Date(`${end.date}T23:59:59.000Z`);
      } else if (end.type === "after") {
        options.count = end.count;
      }
      return stripRulePrefix(new RRule(options));
    }
  }
}

/** The inverse of ruleFromRepeatValue — parses a stored RRULE string back
 * into the Repeats field's UI state so editing a recurring event shows its
 * actual pattern instead of always resetting to "Does not repeat". Falls
 * back to "custom" for any shape that doesn't exactly match one of the
 * fixed quick-pick options (still round-trips correctly, just shown as a
 * custom rule rather than matching one of the canned labels). */
export function repeatValueFromRule(ruleText: string | null | undefined, anchor: Date): RepeatValue {
  if (!ruleText) return defaultRepeatValue(anchor);

  let parsed: ReturnType<typeof RRule.parseString>;
  try {
    parsed = RRule.parseString(ruleText);
  } catch {
    return defaultRepeatValue(anchor);
  }

  const interval = parsed.interval ?? 1;
  const byweekdayList = Array.isArray(parsed.byweekday) ? parsed.byweekday : parsed.byweekday ? [parsed.byweekday] : [];
  const weekdayEntries = byweekdayList.filter(
    (w): w is InstanceType<typeof import("rrule").Weekday> => typeof w === "object" && w !== null && "getJsWeekday" in w,
  );
  const jsWeekdays = weekdayEntries.map((w) => w.getJsWeekday()).sort((a, b) => a - b);

  const end: EndCondition = parsed.until
    ? { type: "on", date: format(parsed.until, "yyyy-MM-dd") }
    : parsed.count
      ? { type: "after", count: parsed.count }
      : { type: "never" };

  if (interval === 1 && end.type === "never") {
    if (parsed.freq === RRule.DAILY && jsWeekdays.length === 0) {
      return { freq: "daily", custom: defaultCustomRepeat(anchor) };
    }
    if (parsed.freq === RRule.WEEKLY && jsWeekdays.length === 5 && jsWeekdays.join(",") === "1,2,3,4,5") {
      return { freq: "weekday", custom: defaultCustomRepeat(anchor) };
    }
    if (parsed.freq === RRule.WEEKLY && jsWeekdays.length === 1 && jsWeekdays[0] === anchor.getDay()) {
      return { freq: "weekly", custom: defaultCustomRepeat(anchor) };
    }
    if (parsed.freq === RRule.MONTHLY && weekdayEntries.length === 1) {
      const [w] = weekdayEntries;
      const expectedNth = isLastWeekdayOfMonth(anchor) ? -1 : nthWeekdayOfMonth(anchor);
      if (w.n === expectedNth && w.getJsWeekday() === anchor.getDay()) {
        return { freq: "monthly", custom: defaultCustomRepeat(anchor) };
      }
    }
    if (parsed.freq === RRule.YEARLY && jsWeekdays.length === 0) {
      return { freq: "annually", custom: defaultCustomRepeat(anchor) };
    }
  }

  const unit: CustomUnit =
    parsed.freq === RRule.DAILY ? "day" : parsed.freq === RRule.WEEKLY ? "week" : parsed.freq === RRule.MONTHLY ? "month" : "year";
  return {
    freq: "custom",
    custom: {
      interval,
      unit,
      weekdays: unit === "week" ? (jsWeekdays.length ? jsWeekdays : [anchor.getDay()]) : [anchor.getDay()],
      end,
    },
  };
}
