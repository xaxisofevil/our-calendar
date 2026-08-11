import { format } from "date-fns";
import type { EventRecord, PersonRecord } from "../types";
import { cx } from "../lib/cx";
import { WEEKDAY_LABELS, dateKey, getMonthGridDays, isSameDay, isSameMonth, isToday } from "../lib/dateUtils";

interface MonthGridProps {
  monthAnchor: Date;
  selectedDate: Date;
  eventsByDay: Map<string, EventRecord[]>;
  personById: Map<number, PersonRecord>;
  onSelectDate: (date: Date) => void;
}

// Defensive cap on rendered dots — only 2 people exist today, but the grid
// cell has limited width and this is a "who has something today" glance,
// not an event counter, so it shouldn't grow unbounded as people are added.
const MAX_DOTS = 4;

/** One dot per distinct person with an event that day (2 events from the
 * same person = 1 dot), plus one neutral dot if any event has no person
 * attributed yet. Capped defensively at MAX_DOTS. */
function distinctDotColors(dayEvents: EventRecord[], personById: Map<number, PersonRecord>, unassignedColor: string): string[] {
  const colors = new Map<string, string>();
  for (const event of dayEvents) {
    if (event.personId != null) {
      const person = personById.get(event.personId);
      colors.set(`person-${event.personId}`, person?.color ?? unassignedColor);
    } else {
      colors.set("unassigned", unassignedColor);
    }
  }
  return Array.from(colors.values()).slice(0, MAX_DOTS);
}

export function MonthGrid({ monthAnchor, selectedDate, eventsByDay, personById, onSelectDate }: MonthGridProps) {
  const days = getMonthGridDays(monthAnchor);

  return (
    <section
      aria-label="Month"
      className="rounded-[var(--radius-panel)] bg-[var(--color-surface)] p-3.5 shadow-[0_1px_0_rgba(40,25,10,0.05),0_12px_26px_-18px_rgba(50,32,12,0.55)]"
    >
      <div className="mb-2 grid grid-cols-7 gap-1">
        {WEEKDAY_LABELS.map((label) => (
          <div
            key={label}
            className="text-center text-[0.62rem] font-extrabold tracking-wide text-[var(--color-ink-faint)] uppercase"
          >
            {label}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map((day) => {
          const key = dateKey(day);
          const inMonth = isSameMonth(day, monthAnchor);
          const today = isToday(day);
          const selected = isSameDay(day, selectedDate);
          const dayEvents = eventsByDay.get(key) ?? [];
          const hasEvent = dayEvents.length > 0;
          const dotColors = hasEvent
            ? distinctDotColors(dayEvents, personById, today ? "var(--color-accent-ink)" : "var(--color-ink-faint)")
            : [];
          const namesForLabel = hasEvent
            ? Array.from(
                new Set(
                  dayEvents.map((e) => (e.personId != null ? (personById.get(e.personId)?.label ?? "someone") : "unassigned")),
                ),
              ).join(", ")
            : "";

          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelectDate(day)}
              aria-current={today ? "date" : undefined}
              aria-pressed={selected}
              aria-label={`${format(day, "EEEE, MMMM d")}${hasEvent ? `, ${dayEvents.length} event${dayEvents.length > 1 ? "s" : ""} (${namesForLabel})` : ", nothing scheduled"}`}
              className={cx(
                "relative aspect-square rounded-lg pt-1.5 text-center transition-colors",
                inMonth ? "text-[var(--color-ink)]" : "font-normal text-[var(--color-ink-faint)] opacity-55",
                today && "bg-[var(--color-accent)] text-[var(--color-accent-ink)]",
                selected &&
                  "shadow-[0_0_0_2px_var(--color-surface),0_0_0_4px_var(--color-ink)]",
              )}
              style={{
                fontFamily: "var(--font-numeral)",
                fontSize: "var(--numeral-size)",
                fontWeight: inMonth ? "var(--numeral-weight)" : 400,
              }}
            >
              {format(day, "d")}
              {hasEvent && (
                <span
                  aria-hidden="true"
                  className="absolute bottom-1.5 left-1/2 flex -translate-x-1/2 gap-[3px]"
                >
                  {dotColors.map((color, i) => (
                    <span key={i} className="h-1 w-1 rounded-full" style={{ backgroundColor: color }} />
                  ))}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}
