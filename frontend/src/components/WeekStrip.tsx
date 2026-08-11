import { format } from "date-fns";
import type { EventRecord } from "../types";
import { cx } from "../lib/cx";
import { WEEKDAY_LABELS, dateKey, isSameDay, isToday } from "../lib/dateUtils";

interface WeekStripProps {
  days: Date[]; // 7 days, Sun-Sat — see lib/dateUtils.ts#getWeekStripDays
  selectedDate: Date;
  eventsByDay: Map<string, EventRecord[]>;
  onSelectDate: (date: Date) => void;
}

/**
 * Mobile default view (this pass, approved "Week Strip + Agenda" mockup
 * direction): a row of 7 day chips replacing the always-full month grid at
 * the top of the screen. Today is selected by default (App.tsx's
 * `selectedDate` initial state); tapping a chip re-selects — same
 * `onSelectDate` callback MonthGrid's own day cells use, so both surfaces
 * write to one shared "selected day" state (per the approved design).
 *
 * Deliberately a single dot per day (not MonthGrid's per-person dedup) —
 * the mockup's chip is small; "something's happening" is all the glance
 * needs here, the agenda panel right below already shows who.
 */
export function WeekStrip({ days, selectedDate, eventsByDay, onSelectDate }: WeekStripProps) {
  return (
    <div className="flex gap-[0.32rem]">
      {days.map((day) => {
        const key = dateKey(day);
        const today = isToday(day);
        const selected = isSameDay(day, selectedDate);
        const dayEvents = eventsByDay.get(key) ?? [];
        const hasEvents = dayEvents.length > 0;

        return (
          <button
            key={key}
            type="button"
            onClick={() => onSelectDate(day)}
            aria-current={today ? "date" : undefined}
            aria-pressed={selected}
            aria-label={`${format(day, "EEEE, MMMM d")}${hasEvents ? `, ${dayEvents.length} event${dayEvents.length > 1 ? "s" : ""}` : ", nothing scheduled"}`}
            className={cx(
              // Exactly one bg-* utility ever applies at once (never both
              // the base and the selected override together) — Tailwind
              // utility precedence follows generated-stylesheet order, not
              // JSX class-list order, so having two competing `bg-`
              // classes present simultaneously would be a real bug, not
              // just redundant (whichever Tailwind happens to emit second
              // in the sheet silently wins, regardless of source order).
              "flex min-w-0 flex-1 cursor-pointer flex-col items-center gap-[0.22rem] rounded-xl border-[1.5px] border-transparent py-2 px-1.5",
              selected ? "bg-[var(--color-accent)]" : "bg-[var(--color-bg)]",
              today && !selected && "border-[var(--color-accent)]",
            )}
          >
            <span
              className={cx(
                "text-[0.58rem] font-extrabold tracking-wide uppercase",
                selected ? "text-[var(--color-accent-ink)]" : "text-[var(--color-ink-faint)]",
              )}
            >
              {WEEKDAY_LABELS[day.getDay()]}
            </span>
            <span
              className={cx(
                "text-base font-extrabold",
                selected ? "text-[var(--color-accent-ink)]" : "text-[var(--color-ink)]",
              )}
              style={{ fontFamily: "var(--font-display)" }}
            >
              {format(day, "d")}
            </span>
            <span
              aria-hidden="true"
              className={cx(
                "mt-[0.05rem] h-[0.28rem] w-[0.28rem] rounded-full",
                hasEvents ? "visible" : "invisible",
                selected ? "bg-[var(--color-accent-ink)]" : "bg-[var(--color-accent)]",
              )}
            />
          </button>
        );
      })}
    </div>
  );
}
