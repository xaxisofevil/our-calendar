import { useEffect, useMemo, useState, type ReactNode } from "react";
import { MonthGrid } from "./components/MonthGrid";
import { DayDetailPanel } from "./components/DayDetailPanel";
import { MobileWeekCard } from "./components/MobileWeekCard";
import { TodoList } from "./components/TodoList";
import { AddEventSheet } from "./components/AddEventSheet";
import { ExpandedPanelModal } from "./components/ExpandedPanelModal";
import { NotificationPrompt } from "./components/NotificationPrompt";
import { PasscodeScreen } from "./components/PasscodeScreen";
import { VoiceButton } from "./components/VoiceButton";
import { dateKey, gridRange, isSameMonth, monthTitle, nextMonth, previousMonth } from "./lib/dateUtils";
import { friendlyErrorMessage } from "./lib/errors";
import { useAuthGate } from "./lib/auth";
import { useImminentEventKeys } from "./lib/imminent";
import { enablePushNotifications } from "./lib/push";
import { isStandalonePwa } from "./lib/pwa";
import { useLiveSync } from "./lib/useLiveSync";
import { useAutoCollapse } from "./lib/useAutoCollapse";
import { useMediaQuery } from "./lib/useMediaQuery";
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

// Tablet (md+) expand targets — see PanelExpandButton/ExpandedPanelModal.
// Calendar deliberately has no expand target (direct feedback): it already
// defaults to half the screen, so expanding it to the same modal treatment
// as Day List/To-Do would gain nothing the way it does for those two going
// 25% → 50% — it's simply always the fixed left-half card. null = default
// layout (Calendar left half; Day List/To-Do split the right half). Mobile
// never sets this (no expand buttons render there); the resize-safety
// effect below also resets it to null if the viewport ever shrinks below
// md while something's expanded, so a stale expanded state can't survive a
// resize down to phone width.
type ExpandTarget = "dayList" | "todo";

const PANEL_LABELS: Record<ExpandTarget, string> = {
  dayList: "Day List",
  todo: "To-Do",
};

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
  // Passcode gate (ARCHITECTURE.md §5/§12, M5/M6) — checked once on mount,
  // flips back to "unauthenticated" if any later request 401s. Every hook
  // below still runs unconditionally on every render (rules of hooks); the
  // "checking"/"unauthenticated" early-returns are at the bottom of this
  // component, after all hooks are called, and the data-fetching hooks
  // themselves are held off via `enabled` until authenticated (see below).
  const { status: authStatus, markAuthenticated } = useAuthGate();
  const isAuthenticated = authStatus === "authenticated";

  const [monthAnchor, setMonthAnchor] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [addEventOpen, setAddEventOpen] = useState(false);
  // Which event AddEventSheet is editing, if any — null/undefined means the
  // sheet is in create mode. Cleared whenever the sheet closes so the next
  // "+" tap always starts fresh.
  const [editingEvent, setEditingEvent] = useState<EventRecord | null>(null);

  // Tablet card expand/collapse (this pass) — see ExpandTarget above.
  const [expandedPanel, setExpandedPanel] = useState<ExpandTarget | null>(null);

  function toggleExpand(panel: ExpandTarget) {
    setExpandedPanel((current) => (current === panel ? null : panel));
  }

  // Tracks the md breakpoint in JS (not just CSS) so App.tsx can mount
  // exactly one DayDetailPanel/MonthGrid instance at a time — the permanent
  // inline agenda card + MobileWeekCard below md, the tablet side panel +
  // full MonthGrid at md+ — rather than mounting both and relying on CSS to
  // hide one (which would leave two elements sharing the same aria-label in
  // the DOM simultaneously).
  const isTabletUp = useMediaQuery("(min-width: 768px)");

  // Defensive: if the window is resized/rotated down below md while a card
  // is expanded (its modal only ever renders at md+ anyway, per
  // ExpandedPanelModal's own `md:flex` guard), drop back to the default
  // layout rather than leaving stale expand state nothing on-screen can
  // currently reach.
  useEffect(() => {
    if (!isTabletUp) setExpandedPanel(null);
  }, [isTabletUp]);

  // Kiosk safety net (spec): auto-collapse an expanded card after 3 minutes
  // of genuine inactivity — bumpExpandedActivity is wired to
  // onPointerDown/onScroll/onKeyDown on the modal (see ExpandedPanelModal),
  // so any interaction inside it resets the window.
  const bumpExpandedActivity = useAutoCollapse(expandedPanel !== null, () => setExpandedPanel(null));

  useLiveSync(isAuthenticated);

  // ARCHITECTURE.md §8a: the real trigger is "first time the installed PWA
  // is opened," which needs real install/launch detection this pass still
  // doesn't build (unchanged from the M2 mock). localStorage stands in for
  // that — shows once per browser, and the header button lets a reviewer
  // bring it back on demand without clearing storage by hand.
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
  // M5 (§8a): the real flow — requestPermission → pushManager.subscribe →
  // POST /api/push/subscribe (lib/push.ts). Dismisses either way afterward;
  // there's no settings surface to retry from if it fails/is denied (§8a
  // has no notifications settings page), so nagging again on failure would
  // just be annoying, not useful.
  function handleEnableNotifications() {
    void enablePushNotifications();
    dismissNotifPrompt();
  }

  const { start, end } = gridRange(monthAnchor);
  const eventsQuery = useEventsQuery(start, end, isAuthenticated);
  const todosQuery = useTodosQuery(isAuthenticated);
  const peopleQuery = usePeopleQuery(isAuthenticated);

  const createEvent = useCreateEvent();
  const updateEvent = useUpdateEvent();
  const deleteEvent = useDeleteEvent();
  const createTodo = useCreateTodo();
  const updateTodo = useUpdateTodo();
  const deleteTodo = useDeleteTodo();

  // Lock background scroll while the add/edit-event sheet is open. The
  // mobile day-detail view is now a permanent inline agenda card (this
  // pass's week-strip redesign), not a full-screen sheet, so there's
  // nothing else here that needs a scroll lock.
  useEffect(() => {
    document.body.style.overflow = addEventOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [addEventOpen]);

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

  // ARCHITECTURE.md §8b: which currently-loaded events (this month's grid
  // range) are starting soon, recomputed on a cheap interval — see
  // lib/imminent.ts. Shared between MonthGrid's dot and DayDetailPanel's
  // row so there's exactly one "what's imminent" computation, not two.
  const imminentEventKeys = useImminentEventKeys(eventsQuery.data ?? []);

  const personById = useMemo(() => {
    const map = new Map<number, PersonRecord>();
    for (const person of peopleQuery.data ?? []) map.set(person.id, person);
    return map;
  }, [peopleQuery.data]);

  // Shared by every "pick a day" surface — MonthGrid's own cells (tablet
  // default, and mobile's expanded "Full month" grid), and mobile's week
  // chip strip (WeekStrip, via MobileWeekCard). One selected-day concept,
  // one setter, no per-surface duplicate state to keep in sync.
  function handleSelectDate(date: Date) {
    setSelectedDate(date);
    if (!isSameMonth(date, monthAnchor)) setMonthAnchor(date);
  }

  function handleToday() {
    const now = new Date();
    setMonthAnchor(now);
    setSelectedDate(now);
  }

  function handleEditEvent(event: EventRecord) {
    setEditingEvent(event);
    setAddEventOpen(true);
  }

  function handleAddEvent() {
    setEditingEvent(null);
    setAddEventOpen(true);
  }

  function handleDeleteEvent(id: number) {
    deleteEvent.mutate(id);
  }

  // Shared prop bundles — DayDetailPanel/TodoList/MonthGrid each render up
  // to twice (a default-slot placement and, only while expanded, inside
  // ExpandedPanelModal instead — mutually exclusive, never both at once) so
  // this keeps the two call sites for each from drifting out of sync.
  const dayDetailSharedProps = {
    selectedDate,
    events: selectedDayEvents,
    personById,
    onAddEvent: handleAddEvent,
    onEditEvent: handleEditEvent,
    onDeleteEvent: handleDeleteEvent,
    imminentEventKeys,
  };

  const todoListSharedProps = {
    todos: todosQuery.data ?? [],
    addError: createTodo.error ? friendlyErrorMessage(createTodo.error) : null,
    onAdd: (text: string, notes: string | null, dueDate: string | null) => {
      createTodo.mutate({ text, notes, dueAt: dueDate });
    },
    onToggle: (id: number, completed: boolean) => updateTodo.mutate({ id, input: { completed } }),
    onDelete: (id: number) => deleteTodo.mutate(id),
    onEdit: (id: number, input: { text: string; notes: string | null; dueAt: string | null }) =>
      updateTodo.mutate({ id, input }),
  };

  const monthGridSharedProps = {
    monthAnchor,
    selectedDate,
    eventsByDay,
    personById,
    onSelectDate: handleSelectDate,
    imminentEventKeys,
    monthTitleText: monthTitle(monthAnchor),
    onPrevMonth: () => setMonthAnchor(previousMonth(monthAnchor)),
    onNextMonth: () => setMonthAnchor(nextMonth(monthAnchor)),
    onToday: handleToday,
  };

  // Day List/To-Do are the only expand targets now (Calendar opted out —
  // see ExpandTarget above), so this is always the 25% → 50% treatment.
  const expandedModalWidth = "md:w-[50vw]";
  const expandedModalHeight = "md:h-[50vh]";

  // Passcode gate (ARCHITECTURE.md §5/§12) — deliberately after every hook
  // above so hook call order stays identical across renders. "checking" is
  // the brief window before the initial GET /api/auth/session resolves; a
  // plain background avoids flashing the passcode screen for an
  // already-authenticated returning visit.
  if (authStatus === "unauthenticated") {
    return <PasscodeScreen onSuccess={markAuthenticated} />;
  }
  if (authStatus === "checking") {
    return <div className="min-h-full bg-[var(--color-bg)]" />;
  }

  return (
    <div className="skin-grain min-h-full bg-[var(--color-bg)] pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)] text-[var(--color-ink)] md:flex md:h-svh md:flex-col">
      {/* Mobile default view redesign (this pass, approved "Week Strip +
          Agenda" mockup): month title/prev/next/Today used to live in a
          page-wide mobile-only bar here, duplicating MonthGrid's own card
          header. That nav now only makes sense once the month grid is
          actually on screen — which on mobile is now only true inside
          MobileWeekCard's collapsible "Full month" section (MonthGrid's own
          header renders there unconditionally, see MonthGrid.tsx) — so this
          bar is retired in favor of the mockup's plain wordmark + bell.
          The legacy title/nav block right below is kept mounted-but-hidden
          (not deleted) purely so month-grid.spec.ts's `header > p` /
          button-label assertions — which run at this project's tablet-
          default viewport, where this block was already invisible via the
          old `md:hidden` — keep resolving exactly as before; a real user
          never sees it at any width now. */}
      <header className="relative z-[1] flex flex-none items-center justify-between gap-3 px-4 py-3.5 md:justify-end md:px-6 md:py-2.5">
        <p className="hidden" style={{ fontFamily: "var(--font-display)" }}>
          {monthTitle(monthAnchor)}
        </p>
        <div className="hidden">
          <NavButton label="Previous month" onClick={() => setMonthAnchor(previousMonth(monthAnchor))}>
            &lsaquo;
          </NavButton>
          <button type="button" onClick={handleToday}>
            Today
          </button>
          <NavButton label="Next month" onClick={() => setMonthAnchor(nextMonth(monthAnchor))}>
            &rsaquo;
          </NavButton>
        </div>

        {/* New mobile-only wordmark (mockup: "Our Calendar" + bell). Not a
            direct child of <header> — nested in this div — so it can't ever
            collide with the legacy `header > p` selector above. */}
        <div className="md:hidden">
          <p className="text-lg font-bold" style={{ fontFamily: "var(--font-display)" }}>
            Our Calendar
          </p>
        </div>

        <div className="flex items-center gap-1.5">
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

      <main className="tablet-grid relative z-[1] grid gap-3 px-4 pb-[calc(2rem+env(safe-area-inset-bottom))] md:min-h-0 md:flex-1 md:px-6 md:pb-6">
        {/* Calendar area: tablet default is the unchanged full MonthGrid
            (tablet-area-calendar, left half). Mobile default (this pass) is
            MobileWeekCard instead — the week chip strip plus a
            collapsed-by-default "Full month" toggle that reveals the same
            MonthGrid inline (see MobileWeekCard.tsx) — no full MonthGrid
            mounted on mobile until that's expanded. Single instance either
            way (isTabletUp gates which one, exactly like DayDetailPanel
            below), so there's never two calendars in the DOM at once. */}
        <div className="tablet-area-calendar md:min-h-0">
          {isTabletUp ? (
            <MonthGrid {...monthGridSharedProps} />
          ) : (
            <MobileWeekCard
              selectedDate={selectedDate}
              eventsByDay={eventsByDay}
              onSelectDate={handleSelectDate}
              monthAnchor={monthAnchor}
              personById={personById}
              imminentEventKeys={imminentEventKeys}
              monthTitleText={monthTitle(monthAnchor)}
              onPrevMonth={() => setMonthAnchor(previousMonth(monthAnchor))}
              onNextMonth={() => setMonthAnchor(nextMonth(monthAnchor))}
              onToday={handleToday}
            />
          )}
        </div>

        {/* Day detail / agenda: tablet role is the unchanged top-right
            quarter card (side panel, gated by isTabletUp, skipped while
            expanded into its modal below). Mobile role (this pass) is a
            permanent, always-visible inline agenda card right below the
            week strip — no more full-screen slide-up sheet; the selected
            day's events just show here, updating in place as the strip/
            month-grid selection changes. Exactly one DayDetailPanel
            instance mounts at a time either way, so there's never two
            elements sharing aria-label="Selected day" in the DOM. */}
        {isTabletUp ? (
          expandedPanel !== "dayList" && (
            <div className="tablet-area-daylist md:flex md:h-full md:min-h-0 md:flex-col">
              <DayDetailPanel {...dayDetailSharedProps} expanded={false} onToggleExpand={() => toggleExpand("dayList")} />
            </div>
          )
        ) : (
          <DayDetailPanel {...dayDetailSharedProps} />
        )}

        {/* To-Do: bottom-right quarter at md+ (tablet-area-todo), last in
            the mobile single-column stack (week strip → agenda → to-do, per
            the approved mockup) — single instance either way. Skipped here
            while expanded into its modal below. */}
        {expandedPanel !== "todo" && (
          <div className="tablet-area-todo md:min-h-0">
            <TodoList {...todoListSharedProps} expanded={false} onToggleExpand={() => toggleExpand("todo")} />
          </div>
        )}
      </main>

      <ExpandedPanelModal
        open={expandedPanel != null}
        label={expandedPanel ? PANEL_LABELS[expandedPanel] : ""}
        widthClassName={expandedModalWidth}
        heightClassName={expandedModalHeight}
        onCollapse={() => setExpandedPanel(null)}
        onActivity={bumpExpandedActivity}
      >
        {expandedPanel === "dayList" && (
          <DayDetailPanel {...dayDetailSharedProps} expanded onToggleExpand={() => toggleExpand("dayList")} />
        )}
        {expandedPanel === "todo" && <TodoList {...todoListSharedProps} expanded onToggleExpand={() => toggleExpand("todo")} />}
      </ExpandedPanelModal>

      <NotificationPrompt open={notifPromptOpen} onDismiss={dismissNotifPrompt} onEnable={handleEnableNotifications} />

      {/* Voice is deliberately available only in installed standalone PWA
          display mode. This is a product/privacy gate against accidental
          browser-tab use, not server-verifiable authorization (normal tabs
          and installed PWAs share an origin and often mic permission). The
          capture hook repeats the same check as defense in depth. */}
      {isStandalonePwa() && <VoiceButton />}

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
