import { useEffect, useState } from "react";
import { format } from "date-fns";
import type { EventRecord, PersonRecord } from "../types";
import { cx } from "../lib/cx";
import { dayDetailLabel } from "../lib/dateUtils";
import { eventImminentKey } from "../lib/imminent";
import { PanelExpandButton } from "./PanelExpandButton";
import { SwipeRevealRow } from "./SwipeRevealRow";

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
  // Tablet card header (this pass) — Day List's own expand button, see
  // PanelExpandButton/ExpandedPanelModal. Undefined on the mobile-only
  // sheet instance (App.tsx), which never renders an expand control.
  expanded?: boolean;
  onToggleExpand?: () => void;
}

export function DayDetailPanel({
  selectedDate,
  events,
  personById,
  onAddEvent,
  onEditEvent,
  onDeleteEvent,
  imminentEventKeys,
  expanded,
  onToggleExpand,
}: DayDetailPanelProps) {
  const hasEvents = events.length > 0;
  // Item 4 (swipe-to-reveal): at most one row's Edit/Delete reveal is open
  // at a time, lifted here (not per-row) so opening a new row's reveal — or
  // tapping outside the list entirely — closes whichever one was open.
  const [openSwipeId, setOpenSwipeId] = useState<number | null>(null);

  useEffect(() => {
    if (openSwipeId == null) return;
    function handlePointerDown(e: PointerEvent) {
      const target = e.target as HTMLElement | null;
      const rowEl = target?.closest("[data-swipe-row-id]");
      const rowId = rowEl?.getAttribute("data-swipe-row-id");
      if (rowId !== String(openSwipeId)) setOpenSwipeId(null);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [openSwipeId]);

  // Selecting a different day (or this panel unmounting/remounting between
  // its default slot and its expanded modal) shouldn't leave a stale swipe
  // open on a row that's no longer even the one under the finger.
  useEffect(() => {
    setOpenSwipeId(null);
  }, [selectedDate]);

  return (
    <section
      aria-label="Selected day"
      className="flex h-full flex-col rounded-[var(--radius-panel)] bg-[var(--color-surface)] p-3.5 shadow-[0_1px_0_rgba(40,25,10,0.05),0_12px_26px_-18px_rgba(50,32,12,0.55)]"
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <p
            className="font-bold"
            style={{ fontFamily: "var(--font-display)", fontSize: "var(--card-title-size)" }}
          >
            {dayDetailLabel(selectedDate)}
          </p>
          <p className="text-xs text-[var(--color-ink-soft)]">
            {hasEvents ? `${events.length} event${events.length > 1 ? "s" : ""}` : "Nothing scheduled"}
          </p>
        </div>
        <div className="flex flex-none items-center gap-1.5">
          <button
            type="button"
            onClick={onAddEvent}
            aria-label="Add event for the selected day"
            className="grid h-8 w-8 flex-none place-items-center rounded-[var(--radius-control)] bg-[var(--color-accent)] text-lg leading-none font-bold text-[var(--color-accent-ink)] cursor-pointer"
          >
            +
          </button>
          {onToggleExpand && (
            <PanelExpandButton expanded={expanded ?? false} onClick={onToggleExpand} label="Day List" className="hidden md:grid" />
          )}
        </div>
      </div>

      {hasEvents ? (
        <ul className="flex flex-col gap-2.5 md:min-h-0 md:flex-1 md:overflow-y-auto">
          {events.map((event) => {
            const person = event.personId != null ? personById.get(event.personId) : undefined;
            const accentColor = person?.color ?? "var(--color-accent)";
            const imminent = imminentEventKeys?.has(eventImminentKey(event)) ?? false;
            return (
              <li key={event.id} data-swipe-row-id={event.id} className={cx(imminent && "imminent-row")}>
                <SwipeRevealRow
                  isOpen={openSwipeId === event.id}
                  onOpenChange={(open) => setOpenSwipeId(open ? event.id : null)}
                  onTap={() => onEditEvent(event)}
                  ariaLabel={`${event.title}, ${event.allDay ? "All day" : format(new Date(event.startAt), "h:mm a")}`}
                  actions={
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setOpenSwipeId(null);
                          onEditEvent(event);
                        }}
                        aria-label={`Edit ${event.title}`}
                        className="flex-1 cursor-pointer rounded-md bg-[var(--color-line)] text-xs font-bold text-[var(--color-ink-soft)]"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setOpenSwipeId(null);
                          onDeleteEvent(event.id);
                        }}
                        aria-label={`Delete ${event.title}`}
                        className="flex-1 cursor-pointer rounded-md bg-[var(--color-accent)]/15 text-xs font-bold text-[var(--color-accent)]"
                      >
                        Delete
                      </button>
                    </>
                  }
                >
                  <div
                    className={cx(
                      "rounded-lg bg-[var(--color-bg)] px-3 py-2.5",
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
                    </div>
                    {(event.location || event.description) && (
                      <p className="mt-1 pl-4 text-xs leading-relaxed text-[var(--color-ink-soft)]">
                        {[event.location, event.description].filter(Boolean).join(" — ")}
                      </p>
                    )}
                  </div>
                </SwipeRevealRow>
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
