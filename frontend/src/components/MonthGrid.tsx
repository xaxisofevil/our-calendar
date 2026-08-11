import { format } from "date-fns";
import type { ReactNode } from "react";
import type { EventRecord, PersonRecord } from "../types";
import { cx } from "../lib/cx";
import { eventImminentKey } from "../lib/imminent";
import { WEEKDAY_LABELS, dateKey, getMonthGridDays, isSameDay, isSameMonth, isToday } from "../lib/dateUtils";

interface MonthGridProps {
  monthAnchor: Date;
  selectedDate: Date;
  eventsByDay: Map<string, EventRecord[]>;
  personById: Map<number, PersonRecord>;
  onSelectDate: (date: Date) => void;
  // ARCHITECTURE.md §8b — keys from lib/imminent.ts#useImminentEventKeys.
  // Which specific event *occurrences* are currently starting soon, so the
  // matching day's dot(s) can pulse. Optional/defaulted so callers that
  // don't care about the feature (e.g. a future storybook/test render)
  // aren't forced to pass an empty Set.
  imminentEventKeys?: Set<string>;
  // Calendar card header: month title + prev/next/Today live directly above
  // the grid (not a page-wide header bar — see App.tsx's global <header>,
  // whose old mobile-only copy of these controls is now retired/hidden in
  // favor of the week-strip mobile redesign). Unconditionally visible
  // whenever MonthGrid renders — see the `embedded`-prop comment above and
  // the header `<div>` below. No expand button here (deliberately, per
  // direct feedback) — on tablet, Calendar already defaults to half the
  // screen, so an expand-to-modal affordance would gain nothing the way it
  // does for Day List/To-Do going 25% → 50%; it's simply always the fixed
  // left-half card there.
  monthTitleText: string;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onToday: () => void;
  // Mobile week-strip's "Full month" expand section (this pass): renders
  // the identical grid/header, just without MonthGrid's own card chrome
  // (background/shadow/padding) so it sits flush on its parent card's
  // surface instead of nesting a visually-redundant second card inside the
  // first — matches the approved mockup's flat treatment. Purely a
  // container-styling switch; the grid/cell/header logic below is
  // completely unchanged either way. Defaults to false (tablet's own
  // boxed-card usage, unchanged).
  embedded?: boolean;
}

function NavButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="grid h-7 w-7 flex-none cursor-pointer place-items-center rounded-full border border-[var(--color-line)] bg-[var(--color-bg)] text-sm text-[var(--color-ink-soft)]"
    >
      {children}
    </button>
  );
}

// Defensive cap on rendered dots — only 2 people exist today, but the grid
// cell has limited width and this is a "who has something today" glance,
// not an event counter, so it shouldn't grow unbounded as people are added.
const MAX_DOTS = 4;

interface DotEntry {
  key: string;
  color: string;
}

/** One dot per distinct person with an event that day (2 events from the
 * same person = 1 dot), plus one neutral dot if any event has no person
 * attributed yet. Capped defensively at MAX_DOTS. Keeps the dedup key
 * alongside the color so the caller can tell which dot corresponds to which
 * person for the imminent-pulse check below (distinct from the color alone,
 * since two people could coincidentally share a color). */
function distinctDotEntries(dayEvents: EventRecord[], personById: Map<number, PersonRecord>, unassignedColor: string): DotEntry[] {
  const colors = new Map<string, string>();
  for (const event of dayEvents) {
    if (event.personId != null) {
      const person = personById.get(event.personId);
      colors.set(`person-${event.personId}`, person?.color ?? unassignedColor);
    } else {
      colors.set("unassigned", unassignedColor);
    }
  }
  return Array.from(colors.entries())
    .slice(0, MAX_DOTS)
    .map(([key, color]) => ({ key, color }));
}

/** Dot size scales inversely with how many distinct people have something
 * that day (direct feedback): a single dot is the strong, glanceable
 * signal it should be; 2-4 dots shrink just enough to keep fitting cleanly
 * side-by-side in the cell without crowding/overlapping. Reads the
 * `--dot-size-N` tokens (tokens.css) rather than a fixed Tailwind size
 * class — those tokens are themselves mobile-base / md+-bumped (same
 * two-tier pattern as --numeral-size), since a size that reads right on a
 * tall tablet cell is too large on an actual phone's compact cell. Applies
 * at every breakpoint via the tokens — this is a data-driven sizing rule,
 * not part of the tablet-only layout restructure. */
function dotSizeVar(count: number): string {
  const n = Math.min(Math.max(count, 1), MAX_DOTS);
  return `var(--dot-size-${n})`;
}

/** Which dot keys (see distinctDotEntries) have at least one imminent event
 * that day — i.e. should pulse. A person with two events that day, only one
 * of which is imminent, still gets a pulsing dot (the dot represents "this
 * person has something happening today," same as its base dedup rule). */
function imminentDotKeys(dayEvents: EventRecord[], imminentEventKeys: Set<string>): Set<string> {
  const keys = new Set<string>();
  for (const event of dayEvents) {
    if (imminentEventKeys.has(eventImminentKey(event))) {
      keys.add(event.personId != null ? `person-${event.personId}` : "unassigned");
    }
  }
  return keys;
}

export function MonthGrid({
  monthAnchor,
  selectedDate,
  eventsByDay,
  personById,
  onSelectDate,
  imminentEventKeys,
  monthTitleText,
  onPrevMonth,
  onNextMonth,
  onToday,
  embedded = false,
}: MonthGridProps) {
  const days = getMonthGridDays(monthAnchor);

  return (
    <section
      aria-label="Month"
      className={cx(
        "rounded-[var(--radius-panel)] md:flex md:h-full md:flex-col",
        embedded
          ? "bg-transparent p-0 shadow-none"
          : "bg-[var(--color-surface)] p-3.5 shadow-[0_1px_0_rgba(40,25,10,0.05),0_12px_26px_-18px_rgba(50,32,12,0.55)]",
      )}
    >
      {/* Month title + prev/next/Today: was `hidden md:flex` (tablet-only —
          mobile used to get an identical copy of these controls in
          App.tsx's page-wide header instead). Now unconditionally visible
          whenever MonthGrid itself renders, since mobile's "Full month"
          expand section (MobileWeekCard.tsx) mounts this same component and
          needs its own nav — MonthGrid no longer mounts at all on mobile
          while collapsed, so this doesn't add new always-on chrome there. */}
      <div className="mb-3 flex flex-none items-center justify-between gap-2">
        <p
          className="font-bold"
          style={{ fontFamily: "var(--font-display)", fontSize: "var(--card-title-size)" }}
        >
          {monthTitleText}
        </p>
        <div className="flex flex-none items-center gap-1.5">
          <NavButton label="Previous month" onClick={onPrevMonth}>
            &lsaquo;
          </NavButton>
          <button
            type="button"
            onClick={onToday}
            className="cursor-pointer rounded-[var(--radius-control)] bg-[var(--color-accent)] px-3 py-1.5 text-[0.66rem] font-extrabold tracking-wide text-[var(--color-accent-ink)] uppercase"
          >
            Today
          </button>
          <NavButton label="Next month" onClick={onNextMonth}>
            &rsaquo;
          </NavButton>
        </div>
      </div>
      <div className="mb-2 grid flex-none grid-cols-7 gap-1">
        {WEEKDAY_LABELS.map((label) => (
          <div
            key={label}
            className="text-center text-[0.62rem] font-extrabold tracking-wide text-[var(--color-ink-faint)] uppercase"
          >
            {label}
          </div>
        ))}
      </div>
      {/* md+ (tablet, ARCHITECTURE.md §4): this is the primary "glance and
          see the month" element, so its rows grow via md:auto-rows-fr to
          fill whatever vertical space the tablet layout gives this column
          — day cells drop their aspect-square cap (md:aspect-auto) and
          stretch (grid's default align-items: stretch) to the larger row
          height instead. Mobile keeps the compact, content-sized square
          grid unchanged. */}
      <div className="grid grid-cols-7 gap-1 md:min-h-0 md:flex-1 md:auto-rows-fr">
        {days.map((day) => {
          const key = dateKey(day);
          const inMonth = isSameMonth(day, monthAnchor);
          const today = isToday(day);
          const selected = isSameDay(day, selectedDate);
          const dayEvents = eventsByDay.get(key) ?? [];
          const hasEvent = dayEvents.length > 0;
          const dotEntries = hasEvent
            ? distinctDotEntries(dayEvents, personById, today ? "var(--color-accent-ink)" : "var(--color-ink-faint)")
            : [];
          const pulsingDotKeys = hasEvent && imminentEventKeys?.size ? imminentDotKeys(dayEvents, imminentEventKeys) : undefined;
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
                "relative aspect-square rounded-lg pt-1.5 text-center transition-colors md:aspect-auto md:pt-2.5",
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
                  className="absolute bottom-1.5 left-1/2 flex -translate-x-1/2 items-center gap-1"
                >
                  {dotEntries.map(({ key: dotKey, color }) => (
                    <span
                      key={dotKey}
                      className={cx("flex-none rounded-full", pulsingDotKeys?.has(dotKey) && "imminent-dot")}
                      style={{
                        backgroundColor: color,
                        width: dotSizeVar(dotEntries.length),
                        height: dotSizeVar(dotEntries.length),
                      }}
                    />
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
