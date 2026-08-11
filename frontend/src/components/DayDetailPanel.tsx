import { format } from "date-fns";
import type { EventRecord, PersonRecord } from "../types";
import { cx } from "../lib/cx";
import { dayDetailLabel } from "../lib/dateUtils";
import { eventImminentKey } from "../lib/imminent";
import { DeleteButton } from "./DeleteButton";

interface DayDetailPanelProps {
  selectedDate: Date;
  events: EventRecord[];
  personById: Map<number, PersonRecord>;
  onAddEvent: () => void;
  onEditEvent: (event: EventRecord) => void;
  onDeleteEvent: (id: number) => void;
  // ARCHITECTURE.md §8b — keys from lib/imminent.ts#useImminentEventKeys.
  // `events` here is already scoped to the selected day, so pulsing an
  // event's row this way automatically satisfies "only if that day is
  // currently selected/visible" — nothing extra to check.
  imminentEventKeys?: Set<string>;
}

export function DayDetailPanel({
  selectedDate,
  events,
  personById,
  onAddEvent,
  onEditEvent,
  onDeleteEvent,
  imminentEventKeys,
}: DayDetailPanelProps) {
  const hasEvents = events.length > 0;

  return (
    <section
      aria-label="Selected day"
      className="flex h-full flex-col rounded-[var(--radius-panel)] bg-[var(--color-surface)] p-3.5 shadow-[0_1px_0_rgba(40,25,10,0.05),0_12px_26px_-18px_rgba(50,32,12,0.55)]"
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <p className="text-base font-bold" style={{ fontFamily: "var(--font-display)" }}>
            {dayDetailLabel(selectedDate)}
          </p>
          <p className="text-xs text-[var(--color-ink-soft)]">
            {hasEvents ? `${events.length} event${events.length > 1 ? "s" : ""}` : "Nothing scheduled"}
          </p>
        </div>
        <button
          type="button"
          onClick={onAddEvent}
          aria-label="Add event for the selected day"
          className="grid h-8 w-8 flex-none place-items-center rounded-[var(--radius-control)] bg-[var(--color-accent)] text-lg leading-none font-bold text-[var(--color-accent-ink)] cursor-pointer"
        >
          +
        </button>
      </div>

      {hasEvents ? (
        <ul className="flex flex-col gap-2.5">
          {events.map((event) => {
            const person = event.personId != null ? personById.get(event.personId) : undefined;
            const accentColor = person?.color ?? "var(--color-accent)";
            const imminent = imminentEventKeys?.has(eventImminentKey(event)) ?? false;
            return (
              <li
                key={event.id}
                role="button"
                tabIndex={0}
                aria-label={`Edit ${event.title}`}
                onClick={() => onEditEvent(event)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onEditEvent(event);
                  }
                }}
                className={cx(
                  "cursor-pointer rounded-lg bg-[var(--color-bg)] px-3 py-2.5 outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]",
                  imminent && "imminent-row",
                )}
                style={{ borderRadius: "4px 12px 12px 4px", borderLeft: `3px dashed ${accentColor}` }}
              >
                <div className="flex items-center gap-2">
                  <span
                    className="h-2 w-2 flex-none rounded-full"
                    style={{ backgroundColor: accentColor }}
                    aria-hidden="true"
                  />
                  <span className="text-sm font-bold">{event.title}</span>
                  {person && (
                    <span
                      className="flex-none rounded-full px-1.5 py-0.5 text-[0.62rem] font-bold"
                      style={{ backgroundColor: `${person.color}22`, color: person.color }}
                    >
                      {person.label}
                    </span>
                  )}
                  <span className="ml-auto text-xs font-bold text-[var(--color-ink-soft)] tabular-nums">
                    {event.allDay ? "All day" : format(new Date(event.startAt), "h:mm a")}
                  </span>
                  {/* Kept a fully separate tap target from the row's own
                      edit-on-tap behavior above (stopPropagation on both
                      mouse and keyboard) — the two must never trigger each
                      other, per ARCHITECTURE.md's delete-affordance note. */}
                  <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} className="flex-none">
                    <DeleteButton label={`Delete ${event.title}`} onClick={() => onDeleteEvent(event.id)} />
                  </div>
                </div>
                {(event.location || event.description) && (
                  <p className="mt-1 pl-4 text-xs leading-relaxed text-[var(--color-ink-soft)]">
                    {[event.location, event.description].filter(Boolean).join(" — ")}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="flex flex-col items-start gap-1">
          <span
            aria-hidden="true"
            className="mb-1 h-8 w-8 rounded-full border-2 border-dashed border-[var(--color-line)]"
          />
          <p className="text-sm font-bold text-[var(--color-ink-soft)]">Nothing scheduled.</p>
          <p className="text-xs leading-relaxed text-[var(--color-ink-faint)]">
            Tap + to add something for this day.
          </p>
        </div>
      )}
    </section>
  );
}
