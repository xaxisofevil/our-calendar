import { useState } from "react";
import type { EventRecord, PersonRecord } from "../types";
import { cx } from "../lib/cx";
import { getWeekStripDays } from "../lib/dateUtils";
import { MonthGrid } from "./MonthGrid";
import { WeekStrip } from "./WeekStrip";

interface MobileWeekCardProps {
  selectedDate: Date;
  eventsByDay: Map<string, EventRecord[]>;
  onSelectDate: (date: Date) => void;
  // Everything MonthGrid needs besides onSelectDate/embedded, which this
  // card supplies itself (see handleGridSelectDate below).
  monthAnchor: Date;
  personById: Map<number, PersonRecord>;
  imminentEventKeys?: Set<string>;
  monthTitleText: string;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onToday: () => void;
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 12 8"
      className={cx("h-2.5 w-3 transition-transform duration-200", open && "rotate-180")}
      aria-hidden="true"
    >
      <path d="M1 1.5 6 6.5 11 1.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Mobile default view's top card (approved "Week Strip + Agenda" mockup,
 * direction 02): the 7-day chip strip plus a collapsed-by-default "Full
 * month" toggle that reveals the real MonthGrid inline, flush on this same
 * card's surface (MonthGrid's `embedded` prop). Both the strip and the
 * expanded grid write to the exact same `selectedDate` state via
 * `onSelectDate` (App.tsx) — there's only ever one "selected day" concept,
 * not two competing ones.
 *
 * Picking a day *in the expanded grid* also collapses the section back down
 * afterward (matches the mockup) — picking a strip chip does not, since the
 * strip is already the default, always-visible affordance.
 */
export function MobileWeekCard({
  selectedDate,
  eventsByDay,
  onSelectDate,
  monthAnchor,
  personById,
  imminentEventKeys,
  monthTitleText,
  onPrevMonth,
  onNextMonth,
  onToday,
}: MobileWeekCardProps) {
  const [expanded, setExpanded] = useState(false);
  const days = getWeekStripDays(selectedDate);

  function handleGridSelectDate(date: Date) {
    onSelectDate(date);
    setExpanded(false);
  }

  return (
    <section
      aria-label="This week"
      className="rounded-[var(--radius-panel)] bg-[var(--color-surface)] p-3.5 shadow-[0_1px_0_rgba(40,25,10,0.05),0_12px_26px_-18px_rgba(50,32,12,0.55)]"
    >
      <WeekStrip days={days} selectedDate={selectedDate} eventsByDay={eventsByDay} onSelectDate={onSelectDate} />

      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="mt-1 flex w-full cursor-pointer items-center justify-center gap-1.5 pt-2 pb-0.5 text-xs font-bold text-[var(--color-ink-soft)]"
      >
        <ChevronIcon open={expanded} />
        {expanded ? "Hide full month" : "Full month"}
      </button>

      {expanded && (
        <div className="pt-2">
          <MonthGrid
            monthAnchor={monthAnchor}
            selectedDate={selectedDate}
            eventsByDay={eventsByDay}
            personById={personById}
            onSelectDate={handleGridSelectDate}
            imminentEventKeys={imminentEventKeys}
            monthTitleText={monthTitleText}
            onPrevMonth={onPrevMonth}
            onNextMonth={onNextMonth}
            onToday={onToday}
            embedded
          />
        </div>
      )}
    </section>
  );
}
