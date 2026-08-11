import { useEffect, useMemo, useState, type ReactNode } from "react";
import { MonthGrid } from "./components/MonthGrid";
import { DayDetailPanel } from "./components/DayDetailPanel";
import { TodoList } from "./components/TodoList";
import { AddEventSheet } from "./components/AddEventSheet";
import { cx } from "./lib/cx";
import { dateKey, gridRange, isSameMonth, monthTitle, nextMonth, previousMonth } from "./lib/dateUtils";
import {
  useCreateEvent,
  useCreateTodo,
  useDeleteEvent,
  useDeleteTodo,
  useEventsQuery,
  usePeopleQuery,
  useTodosQuery,
  useUpdateTodo,
} from "./lib/queries";
import type { EventRecord, PersonRecord } from "./types";

function NavButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="grid h-7 w-7 flex-none cursor-pointer place-items-center rounded-full border border-[var(--color-line)] bg-[var(--color-surface)] text-sm text-[var(--color-ink-soft)]"
    >
      {children}
    </button>
  );
}

function App() {
  const [monthAnchor, setMonthAnchor] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [addEventOpen, setAddEventOpen] = useState(false);

  const { start, end } = gridRange(monthAnchor);
  const eventsQuery = useEventsQuery(start, end);
  const todosQuery = useTodosQuery();
  const peopleQuery = usePeopleQuery();

  const createEvent = useCreateEvent();
  const deleteEvent = useDeleteEvent();
  const createTodo = useCreateTodo();
  const updateTodo = useUpdateTodo();
  const deleteTodo = useDeleteTodo();

  // Lock background scroll while a full-screen mobile sheet is open.
  useEffect(() => {
    document.body.style.overflow = mobileDetailOpen || addEventOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileDetailOpen, addEventOpen]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, EventRecord[]>();
    for (const event of eventsQuery.data ?? []) {
      const key = dateKey(new Date(event.startAt));
      const list = map.get(key) ?? [];
      list.push(event);
      map.set(key, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.startAt.localeCompare(b.startAt));
    return map;
  }, [eventsQuery.data]);

  const selectedDayEvents = eventsByDay.get(dateKey(selectedDate)) ?? [];

  const personById = useMemo(() => {
    const map = new Map<number, PersonRecord>();
    for (const person of peopleQuery.data ?? []) map.set(person.id, person);
    return map;
  }, [peopleQuery.data]);

  function handleSelectDate(date: Date) {
    setSelectedDate(date);
    if (!isSameMonth(date, monthAnchor)) setMonthAnchor(date);
    setMobileDetailOpen(true);
  }

  function handleToday() {
    const now = new Date();
    setMonthAnchor(now);
    setSelectedDate(now);
    setMobileDetailOpen(true);
  }

  return (
    <div className="skin-grain min-h-full bg-[var(--color-bg)] text-[var(--color-ink)]">
      <header className="relative z-[1] flex items-center justify-between gap-3 px-4 py-3.5 md:px-6 md:py-4">
        <p className="text-xl font-bold" style={{ fontFamily: "var(--font-display)" }}>
          {monthTitle(monthAnchor)}
        </p>
        <div className="flex items-center gap-1.5">
          <NavButton label="Previous month" onClick={() => setMonthAnchor(previousMonth(monthAnchor))}>
            &lsaquo;
          </NavButton>
          <button
            type="button"
            onClick={handleToday}
            className="cursor-pointer rounded-[var(--radius-control)] bg-[var(--color-accent)] px-3 py-1.5 text-[0.66rem] font-extrabold tracking-wide text-[var(--color-accent-ink)] uppercase"
          >
            Today
          </button>
          <NavButton label="Next month" onClick={() => setMonthAnchor(nextMonth(monthAnchor))}>
            &rsaquo;
          </NavButton>
        </div>
      </header>

      {eventsQuery.isError && (
        <p className="relative z-[1] mx-4 mb-2 rounded-lg bg-[var(--color-accent)]/10 px-3 py-2 text-xs text-[var(--color-ink-soft)] md:mx-6">
          Couldn't reach the server for events. Showing what's cached, if anything.
        </p>
      )}

      <main className="relative z-[1] grid gap-3 px-4 pb-8 md:grid-cols-[1.15fr_0.85fr_0.85fr] md:items-start md:px-6">
        <MonthGrid
          monthAnchor={monthAnchor}
          selectedDate={selectedDate}
          eventsByDay={eventsByDay}
          personById={personById}
          onSelectDate={handleSelectDate}
        />

        {/* Day detail: an always-visible column on tablet (md+), a
            full-screen slide-up sheet on iPhone width — same content
            component either way, only the shell around it changes via
            CSS breakpoints (ARCHITECTURE.md §4). */}
        <div
          className={cx(
            "fixed inset-0 z-40 flex flex-col justify-end bg-black/35 transition-opacity duration-300 ease-out",
            "md:static md:z-auto md:block md:bg-transparent md:p-0 md:transition-none",
            mobileDetailOpen ? "opacity-100" : "pointer-events-none opacity-0 md:pointer-events-auto md:opacity-100",
          )}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setMobileDetailOpen(false);
          }}
        >
          <div
            className={cx(
              "max-h-[85vh] overflow-y-auto rounded-t-[20px] transition-transform duration-300 ease-out",
              "md:static md:max-h-none md:translate-y-0 md:overflow-visible md:rounded-none md:transition-none",
              mobileDetailOpen ? "translate-y-0" : "translate-y-full md:translate-y-0",
            )}
          >
            <div className="flex justify-end px-3 pt-2 md:hidden">
              <button
                type="button"
                onClick={() => setMobileDetailOpen(false)}
                className="cursor-pointer rounded-full bg-[var(--color-surface)] px-3 py-1 text-xs font-bold text-[var(--color-ink-soft)]"
              >
                Close
              </button>
            </div>
            <div className="px-0 pb-3 md:pb-0">
              <DayDetailPanel
                selectedDate={selectedDate}
                events={selectedDayEvents}
                personById={personById}
                onAddEvent={() => setAddEventOpen(true)}
                onDeleteEvent={(id) => deleteEvent.mutate(id)}
              />
            </div>
          </div>
        </div>

        <TodoList
          todos={todosQuery.data ?? []}
          onAdd={(text, notes) => createTodo.mutate({ text, notes })}
          onToggle={(id, completed) => updateTodo.mutate({ id, input: { completed } })}
          onDelete={(id) => deleteTodo.mutate(id)}
        />
      </main>

      <AddEventSheet
        open={addEventOpen}
        selectedDate={selectedDate}
        people={peopleQuery.data ?? []}
        onClose={() => setAddEventOpen(false)}
        onSave={(input) => {
          createEvent.mutate(input);
          setAddEventOpen(false);
        }}
      />
    </div>
  );
}

export default App;
