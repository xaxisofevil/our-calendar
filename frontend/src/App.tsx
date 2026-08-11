import { useEffect, useMemo, useState, type ReactNode } from "react";
import { MonthGrid } from "./components/MonthGrid";
import { DayDetailPanel } from "./components/DayDetailPanel";
import { TodoList } from "./components/TodoList";
import { AddEventSheet } from "./components/AddEventSheet";
import { NotificationPrompt } from "./components/NotificationPrompt";
import { cx } from "./lib/cx";
import { dateKey, gridRange, isSameMonth, monthTitle, nextMonth, previousMonth } from "./lib/dateUtils";
import { friendlyErrorMessage } from "./lib/errors";
import { useLiveSync } from "./lib/useLiveSync";
import {
  useCreateEvent,
  useCreateTodo,
  useDeleteEvent,
  useDeleteTodo,
  useEventsQuery,
  usePeopleQuery,
  useTodosQuery,
  useUpdateEvent,
  useUpdateTodo,
} from "./lib/queries";
import type { EventRecord, PersonRecord } from "./types";

const NOTIF_PROMPT_SEEN_KEY = "our-calendar:notif-prompt-seen";

function BellOutlineIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" aria-hidden="true">
      <path
        d="M10 2.5c-2.2 0-4 1.8-4 4v2.4c0 .5-.2 1-.5 1.4L4.3 12a1 1 0 0 0 .8 1.6h9.8a1 1 0 0 0 .8-1.6l-1.2-1.7c-.3-.4-.5-.9-.5-1.4V6.5c0-2.2-1.8-4-4-4Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M8.2 15.3a1.9 1.9 0 0 0 3.6 0" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

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
  // Which event AddEventSheet is editing, if any — null/undefined means the
  // sheet is in create mode. Cleared whenever the sheet closes so the next
  // "+" tap always starts fresh.
  const [editingEvent, setEditingEvent] = useState<EventRecord | null>(null);

  useLiveSync();

  // M2 UI-only mock (ARCHITECTURE.md §8a): the real trigger is "first time
  // the installed PWA is opened," which needs real install/launch detection
  // this pass deliberately doesn't build. localStorage stands in for that —
  // shows once per browser, and the header button lets a reviewer bring it
  // back on demand without clearing storage by hand.
  const [notifPromptOpen, setNotifPromptOpen] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem(NOTIF_PROMPT_SEEN_KEY) !== "1") setNotifPromptOpen(true);
    } catch {
      setNotifPromptOpen(true);
    }
  }, []);
  function dismissNotifPrompt() {
    setNotifPromptOpen(false);
    try {
      localStorage.setItem(NOTIF_PROMPT_SEEN_KEY, "1");
    } catch {
      // localStorage unavailable — prompt just won't "remember" being dismissed across reloads
    }
  }
  function previewNotifPrompt() {
    try {
      localStorage.removeItem(NOTIF_PROMPT_SEEN_KEY);
    } catch {
      // no-op
    }
    setNotifPromptOpen(true);
  }

  const { start, end } = gridRange(monthAnchor);
  const eventsQuery = useEventsQuery(start, end);
  const todosQuery = useTodosQuery();
  const peopleQuery = usePeopleQuery();

  const createEvent = useCreateEvent();
  const updateEvent = useUpdateEvent();
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
          <button
            type="button"
            onClick={previewNotifPrompt}
            aria-label="Preview the one-time notifications prompt (review aid, not part of the real UI)"
            title="Preview the one-time notifications prompt"
            className="grid h-7 w-7 flex-none cursor-pointer place-items-center rounded-full border border-dashed border-[var(--color-line)] text-[var(--color-ink-faint)]"
          >
            <BellOutlineIcon />
          </button>
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
                onAddEvent={() => {
                  setEditingEvent(null);
                  setAddEventOpen(true);
                }}
                onEditEvent={(event) => {
                  setEditingEvent(event);
                  setAddEventOpen(true);
                }}
                onDeleteEvent={(id) => deleteEvent.mutate(id)}
              />
            </div>
          </div>
        </div>

        <TodoList
          todos={todosQuery.data ?? []}
          addError={createTodo.error ? friendlyErrorMessage(createTodo.error) : null}
          onAdd={(text, notes, dueDate) => {
            createTodo.mutate({ text, notes, dueAt: dueDate });
          }}
          onToggle={(id, completed) => updateTodo.mutate({ id, input: { completed } })}
          onDelete={(id) => deleteTodo.mutate(id)}
        />
      </main>

      <NotificationPrompt open={notifPromptOpen} onDismiss={dismissNotifPrompt} />

      <AddEventSheet
        open={addEventOpen}
        selectedDate={selectedDate}
        people={peopleQuery.data ?? []}
        editingEvent={editingEvent}
        error={
          editingEvent
            ? updateEvent.isError
              ? friendlyErrorMessage(updateEvent.error)
              : null
            : createEvent.isError
              ? friendlyErrorMessage(createEvent.error)
              : null
        }
        onClose={() => {
          setAddEventOpen(false);
          setEditingEvent(null);
          createEvent.reset();
          updateEvent.reset();
        }}
        onSave={(input, editingId) => {
          // Only close/clear on success — a rejected mutation (e.g. a
          // 200-char title cap) now leaves the sheet open with its error
          // banner visible instead of closing unconditionally (see
          // ARCHITECTURE.md M2 bug report #2).
          if (editingId != null) {
            updateEvent.mutate(
              { id: editingId, input },
              {
                onSuccess: () => {
                  setAddEventOpen(false);
                  setEditingEvent(null);
                },
              },
            );
          } else {
            createEvent.mutate(input, {
              onSuccess: () => {
                setAddEventOpen(false);
                setEditingEvent(null);
              },
            });
          }
        }}
      />
    </div>
  );
}

export default App;
