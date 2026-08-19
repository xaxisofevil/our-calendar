import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { format } from "date-fns";
import type { PersonRecord, TodoRecord } from "../types";
import { cx } from "../lib/cx";
import { PanelExpandButton } from "./PanelExpandButton";
import { SwipeRevealRow } from "./SwipeRevealRow";

export interface TodoEditInput {
  text: string;
  notes: string | null;
  dueAt: string | null;
  personId: number | null;
  alsoShared: boolean;
}

interface TodoListProps {
  todos: TodoRecord[];
  /** Direct request: person-scoped lists. Only Eric/Lindsay ever get their
   * own list/chip — deliberately not "whoever's in the household," so this
   * is found by label out of the full people list, not assumed to be
   * exactly people[0]/people[1]. Missing gracefully (e.g. before seed data
   * exists) just means that chip/picker option doesn't render. */
  people: PersonRecord[];
  /** Message from the create-todo mutation, if it failed server-side (e.g.
   * text over the 500-char limit) — see ARCHITECTURE.md M2 bug report #3. */
  addError?: string | null;
  onAdd: (text: string, notes: string | null, dueDate: string | null, personId: number | null, alsoShared: boolean) => void;
  onToggle: (id: number, completed: boolean) => void;
  onDelete: (id: number) => void;
  /** New (this pass): the first "edit an existing todo" flow — a
   * lightweight inline form (same spirit as quick-add's own optional-details
   * fields), reached via the swipe-revealed Edit button. */
  onEdit: (id: number, input: TodoEditInput) => void;
  // Tablet card header (this pass) — To-Do's own expand button.
  expanded?: boolean;
  onToggleExpand?: () => void;
}

/** "Shared" | a specific person's id — used both for the top filter tabs
 * (which list is currently displayed) and the create/edit person-picker
 * (which list a specific item belongs to). Same three-way shape, two
 * different jobs — kept as one type since every consumer needs exactly
 * this choice. */
type ListScope = "shared" | number;

/** Shared visual chip — colored dot + label, filled with the person's own
 * color when active (mirrors AddEventSheet's existing "For" picker exactly,
 * so this reads as the same established pattern, not a new one). `null`
 * person means the "Shared" option — no color of its own, uses the app's
 * accent color instead. */
function ListScopeChip({
  person,
  active,
  onClick,
}: {
  person: PersonRecord | null;
  active: boolean;
  onClick: () => void;
}) {
  const color = person?.color ?? "var(--color-accent)";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        "flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs font-bold transition-colors",
        active ? "border-transparent text-white" : "border-[var(--color-line)] text-[var(--color-ink-soft)]",
      )}
      style={active ? { backgroundColor: color } : undefined}
    >
      <span
        className="h-2 w-2 flex-none rounded-full"
        style={{ backgroundColor: active ? "rgba(255,255,255,0.85)" : color }}
        aria-hidden="true"
      />
      {person?.label ?? "Shared"}
    </button>
  );
}

const HIDE_COMPLETED_KEY = "our-calendar:hide-completed-todos";

function readHideCompleted(): boolean {
  try {
    return localStorage.getItem(HIDE_COMPLETED_KEY) === "1";
  } catch {
    return false;
  }
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 12 10" className="h-2.5 w-3" aria-hidden="true">
      <path
        d="M1 5l3.2 3.2L11 1"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function NoteIcon() {
  return (
    <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" aria-hidden="true">
      <rect x="1.5" y="1.5" width="11" height="11" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <line x1="4" y1="5" x2="10" y2="5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <line x1="4" y1="7.7" x2="10" y2="7.7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <line x1="4" y1="10.4" x2="7.5" y2="10.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

/** Direct request: the quick-add button was a plain "+" regardless of
 * whether there was anything to submit, leaving it genuinely unclear that
 * tapping it (or hitting Enter) actually sends the item — "does the
 * keyboard just make a carriage return?" It can't; this is a single-line
 * `<input>`, not a `<textarea>`, so Enter only ever does nothing or
 * submits. The real fix is the button itself, not an explanation: once
 * there's text to send, it swaps to this arrow (the same visual language
 * as a messaging app's own send button — matches "as fast as a text
 * message," the actual bar this was measured against) so the affordance
 * is obvious without having to ask. */
function SendIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-3 w-3" aria-hidden="true">
      <path
        d="M4.5 10h11M9.5 5l5 5-5 5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 14 14" className="h-3 w-3 flex-none" aria-hidden="true">
      <rect x="1.5" y="2.5" width="11" height="10" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <line x1="1.5" y1="5.3" x2="12.5" y2="5.3" stroke="currentColor" strokeWidth="1.2" />
      <line x1="4" y1="1.2" x2="4" y2="3.6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <line x1="10" y1="1.2" x2="10" y2="3.6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function parseDueDate(dueDate: string): Date {
  return new Date(`${dueDate}T00:00:00`);
}

function isOverdue(dueDate: string): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return parseDueDate(dueDate) < today;
}

/** New (this pass, item 5): lightweight inline edit form, pre-filled from
 * the todo's current text/notes/due date — same shape as quick-add's own
 * optional-details fields, deliberately not a heavier modal system. */
function TodoEditForm({
  todo,
  eric,
  lindsay,
  onSave,
  onCancel,
}: {
  todo: TodoRecord;
  eric: PersonRecord | null;
  lindsay: PersonRecord | null;
  onSave: (input: TodoEditInput) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(todo.text);
  const [notes, setNotes] = useState(todo.notes ?? "");
  const [dueDate, setDueDate] = useState(todo.dueAt ?? "");
  const [scope, setScope] = useState<ListScope>(todo.personId ?? "shared");
  const [alsoShared, setAlsoShared] = useState(todo.alsoShared);

  function save() {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSave({
      text: trimmed,
      notes: notes.trim() ? notes.trim() : null,
      dueAt: dueDate || null,
      personId: scope === "shared" ? null : scope,
      alsoShared: scope === "shared" ? false : alsoShared,
    });
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-dashed border-[var(--color-accent)] bg-[var(--color-bg)] p-2.5">
      <label className="flex flex-col gap-1">
        <span className="text-[0.6rem] font-semibold text-[var(--color-ink-faint)]">Text</span>
        <input
          value={text}
          autoFocus
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save();
            }
            if (e.key === "Escape") onCancel();
          }}
          aria-label={`Edit text for ${todo.text}`}
          // text-base (16px), not text-sm — real bug class, direct request:
          // iOS Safari auto-zooms the whole page when focusing a form
          // element with font-size under 16px (it assumes small text means
          // hard to type into), and the zoom doesn't reset cleanly
          // afterward. 16px is the documented safe floor; every real
          // <input>/<textarea> in this file uses it now, not just this one.
          className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 py-1.5 text-base outline-none focus:border-[var(--color-accent)]"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[0.6rem] font-semibold text-[var(--color-ink-faint)]">Notes (optional)</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          aria-label={`Edit notes for ${todo.text}`}
          className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 py-1.5 text-base leading-relaxed outline-none"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[0.6rem] font-semibold text-[var(--color-ink-faint)]">Due date (optional)</span>
        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          aria-label={`Edit due date for ${todo.text}`}
          className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 py-1.5 text-base outline-none"
        />
      </label>
      {(eric || lindsay) && (
        <div className="flex flex-col gap-1">
          <span className="text-[0.6rem] font-semibold text-[var(--color-ink-faint)]">List</span>
          <div className="flex flex-wrap gap-1.5">
            <ListScopeChip person={null} active={scope === "shared"} onClick={() => setScope("shared")} />
            {eric && <ListScopeChip person={eric} active={scope === eric.id} onClick={() => setScope(eric.id)} />}
            {lindsay && (
              <ListScopeChip person={lindsay} active={scope === lindsay.id} onClick={() => setScope(lindsay.id)} />
            )}
          </div>
          {scope !== "shared" && (
            <label className="mt-0.5 flex items-center gap-1.5 text-[0.66rem] text-[var(--color-ink-soft)]">
              <input
                type="checkbox"
                checked={alsoShared}
                onChange={(e) => setAlsoShared(e.target.checked)}
                className="h-3.5 w-3.5 cursor-pointer accent-[var(--color-accent)]"
              />
              Also show in Shared
            </label>
          )}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          aria-label={`Cancel editing ${todo.text}`}
          className="cursor-pointer rounded-full border border-[var(--color-line)] px-3 py-1.5 text-xs font-bold text-[var(--color-ink-soft)]"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          aria-label={`Save changes to ${todo.text}`}
          className="cursor-pointer rounded-full bg-[var(--color-accent)] px-3.5 py-1.5 text-xs font-bold text-[var(--color-accent-ink)]"
        >
          Save
        </button>
      </div>
    </div>
  );
}

export function TodoList({ todos, people, addError, onAdd, onToggle, onDelete, onEdit, expanded, onToggleExpand }: TodoListProps) {
  const eric = people.find((p) => p.label === "Eric") ?? null;
  const lindsay = people.find((p) => p.label === "Lindsay") ?? null;

  const [text, setText] = useState("");
  const [notes, setNotes] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [hideCompleted, setHideCompleted] = useState(readHideCompleted);
  const [openSwipeId, setOpenSwipeId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  // Direct request: person-scoped lists. Which list is currently displayed
  // (top chips) — also doubles as the default scope for a newly-added item,
  // so adding while viewing Eric's list defaults new items there rather
  // than always defaulting to Shared.
  const [listScope, setListScope] = useState<ListScope>("shared");
  const [addScope, setAddScope] = useState<ListScope>("shared");
  const [addAlsoShared, setAddAlsoShared] = useState(false);

  // Keep the quick-add picker's default following whichever tab is
  // currently open — switching to Eric's list should mean "add" defaults
  // there too, not silently stay on whatever was picked before. Still
  // freely overridable per-item in the picker itself.
  useEffect(() => {
    setAddScope(listScope);
    setAddAlsoShared(false);
  }, [listScope]);

  // Direct request: replace the persistent inline quick-add row with a
  // "+"-triggered modal, matching how AddEventSheet already works — one
  // "how do I add something" pattern across the app instead of two, and it
  // reclaims real estate the persistent row + new list chips were both
  // fighting the actual task list for on mobile. The speed goal this was
  // built around ("as fast as a text message") doesn't get lost: the
  // modal's own input still submits through the exact same fast/optimistic
  // path as before, and — matching a messaging app's own send behavior —
  // a successful add does NOT close the modal, just clears + refocuses the
  // input for the next item. Only an explicit close (button/backdrop/
  // Escape) actually dismisses it, so several items can go in back-to-back
  // without reopening each time.
  const [addModalOpen, setAddModalOpen] = useState(false);
  const addInputRef = useRef<HTMLInputElement>(null);
  // Direct request: the modal is a fixed-position bottom sheet, and the
  // page behind it is deliberately still scrollable (kept, on request) —
  // but a `position: fixed` element always covers the *same* screen region
  // regardless of scroll position, so as the list grows while adding
  // several items in a row, new rows landing in that region become
  // permanently unreachable by scrolling: no scroll position ever brings
  // them out from behind the sheet. scroll-margin-bottom (below, on the
  // <ul> itself) tells the browser's own scrollIntoView to always leave
  // room for the sheet; this ref is what triggers that scroll after each
  // successful add, in submit() below.
  const listRef = useRef<HTMLUListElement>(null);

  const closeAddModal = useCallback(() => {
    setAddModalOpen(false);
    setText("");
    setNotes("");
    setDueDate("");
    setDetailsOpen(false);
    setAddScope(listScope);
    setAddAlsoShared(false);
  }, [listScope]);

  useEffect(() => {
    if (!addModalOpen) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeAddModal();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [addModalOpen, closeAddModal]);

  // Item 4/5: tapping outside the currently-open swipe reveal (another row,
  // or anywhere else in/outside the list) closes it — same pattern as
  // DayDetailPanel's event rows.
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

  function updateHideCompleted(next: boolean) {
    setHideCompleted(next);
    try {
      localStorage.setItem(HIDE_COMPLETED_KEY, next ? "1" : "0");
    } catch {
      // localStorage unavailable (private mode, etc.) — setting just won't persist across reloads
    }
  }

  function submit() {
    const trimmed = text.trim();
    if (!trimmed) return;
    onAdd(
      trimmed,
      notes.trim() ? notes.trim() : null,
      dueDate || null,
      addScope === "shared" ? null : addScope,
      addScope === "shared" ? false : addAlsoShared,
    );
    setText("");
    setNotes("");
    setDueDate("");
    setDetailsOpen(false);
    // Matches a messaging app's own send behavior — clear + refocus for the
    // next item rather than closing. Deferred a tick so it runs after
    // React's own re-render (an immediate synchronous focus() call here can
    // race the DOM update and silently no-op on some mobile browsers).
    // Same tick also scrolls the newest item out from behind the fixed
    // modal sheet — see listRef's own comment for why this is needed at
    // all, given background scroll is deliberately still allowed.
    setTimeout(() => {
      addInputRef.current?.focus();
      listRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }, 0);
  }

  function toggleExpanded(id: number) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Shared shows everything with no owner, plus any personal item that
  // opted in via alsoShared; a person's tab shows only what's actually
  // theirs — alsoShared doesn't leak an item onto a *different* person's
  // tab, only onto Shared.
  const scopedTodos =
    listScope === "shared" ? todos.filter((t) => t.personId == null || t.alsoShared) : todos.filter((t) => t.personId === listScope);
  const visibleTodos = hideCompleted ? scopedTodos.filter((t) => !t.completed) : scopedTodos;
  const hiddenCount = scopedTodos.length - visibleTodos.length;

  // ARCHITECTURE.md §8: incomplete overdue items float to the top,
  // most-overdue-first — purely a display sort, nothing auto-mutates.
  // Completed items (and everything else) keep their existing relative
  // (position) order.
  const sortedTodos = useMemo(() => {
    const overdueItems = visibleTodos.filter((t) => !t.completed && t.dueAt && isOverdue(t.dueAt));
    overdueItems.sort((a, b) => a.dueAt!.localeCompare(b.dueAt!));
    const overdueIds = new Set(overdueItems.map((t) => t.id));
    const rest = visibleTodos.filter((t) => !overdueIds.has(t.id));
    return [...overdueItems, ...rest];
  }, [visibleTodos]);

  const sectionContent = (
    <section
      aria-label="Household to-do list"
      className="rounded-[var(--radius-panel)] bg-[var(--color-surface)] p-3.5 shadow-[0_1px_0_rgba(40,25,10,0.05),0_12px_26px_-18px_rgba(50,32,12,0.55)] md:flex md:h-full md:flex-col"
    >
      {/* Direct request: the subtitle ("Shared list — not tied to any
          date") is gone, and the Shared/Eric/Lindsay tabs moved up onto
          this same row as the title — on mobile there was nothing else in
          this row (the expand button is tablet-only), leaving a whole
          empty half-width strip to the title's right for no reason. */}
      <div className="mb-2.5 flex flex-none items-start justify-between gap-2">
        <p className="flex-none font-bold" style={{ fontFamily: "var(--font-display)", fontSize: "var(--card-title-size)" }}>
          To-Do
        </p>
        <div className="flex items-center gap-1.5">
          {/* Only rendered once Eric/Lindsay actually exist in the people
              list; a plain Shared-only household (or before seed data
              exists) sees no tabs at all rather than two dead/empty ones. */}
          {(eric || lindsay) && (
            <div className="flex flex-wrap justify-end gap-1.5">
              <ListScopeChip person={null} active={listScope === "shared"} onClick={() => setListScope("shared")} />
              {eric && (
                <ListScopeChip person={eric} active={listScope === eric.id} onClick={() => setListScope(eric.id)} />
              )}
              {lindsay && (
                <ListScopeChip
                  person={lindsay}
                  active={listScope === lindsay.id}
                  onClick={() => setListScope(lindsay.id)}
                />
              )}
            </div>
          )}
          {onToggleExpand && (
            <PanelExpandButton expanded={expanded ?? false} onClick={onToggleExpand} label="To-Do" className="hidden md:grid" />
          )}
        </div>
      </div>

      {/* Direct request: this used to be a real, always-visible <input> —
          now it's a button styled to look exactly like one, so tapping it
          reads as "tap the text box and start typing" even though what
          actually happens is a modal opening with the real input inside.
          The visual continuity is the whole point: the extra tap should be
          nearly invisible, not a detour. */}
      <button
        type="button"
        onClick={() => setAddModalOpen(true)}
        aria-label="Add a to-do item"
        className="mb-3 flex flex-none cursor-pointer items-center gap-2 rounded-full border border-[var(--color-line)] bg-[var(--color-bg)] py-1 pr-1 pl-3 text-left"
      >
        <span className="min-w-0 flex-1 truncate text-sm text-[var(--color-ink-faint)]">Add an item…</span>
        {/* 44px, not the original 22px — direct request, matches the
            ~44px minimum tap-target guideline (Apple HIG/Android's own
            48dp) other primary controls in this app already use (e.g.
            VoiceButton's 64px mic button). This one's purely decorative
            (the whole pill is one tap target already), but kept in visual
            sync with the modal's own real Send button below, which does
            need the size for real. */}
        <span
          aria-hidden="true"
          className="grid h-11 w-11 flex-none place-items-center rounded-full bg-[var(--color-accent)] text-sm leading-none font-bold text-[var(--color-accent-ink)]"
        >
          +
        </span>
      </button>

      <ul
        ref={listRef}
        // scroll-margin-bottom reserves room for the modal's own typical
        // height when it's open — otherwise scrollIntoView (submit()
        // above) would happily scroll a new item to the very bottom edge
        // of the *viewport*, which is still behind the fixed sheet.
        // 50vh is a deliberately generous estimate (the sheet is usually
        // shorter), not a measurement of the sheet's real height — safe to
        // over-reserve here, since the only cost is scrolling slightly
        // further than strictly necessary.
        style={{ scrollMarginBottom: "50vh" }}
        className="flex flex-col gap-1.5 md:min-h-0 md:flex-1 md:overflow-y-auto"
      >
        {sortedTodos.map((todo) => {
          const dueDateValue = todo.dueAt;
          const overdue = dueDateValue ? !todo.completed && isOverdue(dueDateValue) : false;

          if (editingId === todo.id) {
            return (
              <li key={todo.id}>
                <TodoEditForm
                  todo={todo}
                  eric={eric}
                  lindsay={lindsay}
                  onCancel={() => setEditingId(null)}
                  onSave={(input) => {
                    onEdit(todo.id, input);
                    setEditingId(null);
                  }}
                />
              </li>
            );
          }

          return (
            <li key={todo.id} data-swipe-row-id={todo.id}>
              <SwipeRevealRow
                isOpen={openSwipeId === todo.id}
                onOpenChange={(open) => setOpenSwipeId(open ? todo.id : null)}
                onTap={() => {}}
                ariaLabel={`${todo.text} row`}
                actions={
                  <>
                    <button
                      type="button"
                      disabled={todo.pending}
                      onClick={() => {
                        setOpenSwipeId(null);
                        setEditingId(todo.id);
                      }}
                      aria-label={`Edit ${todo.text}`}
                      className="flex-1 cursor-pointer rounded-md bg-[var(--color-line)] text-xs font-bold text-[var(--color-ink-soft)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      disabled={todo.pending}
                      onClick={() => {
                        setOpenSwipeId(null);
                        onDelete(todo.id);
                      }}
                      aria-label={`Delete ${todo.text}`}
                      className="flex-1 cursor-pointer rounded-md bg-[var(--color-accent)]/15 text-xs font-bold text-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </>
                }
              >
                {/* Optimistic-update pending state (lib/queries.ts) — dimmed,
                    not hidden or styled as if already confirmed. A save that
                    actually fails rolls back visibly (the row just
                    disappears/reverts) rather than silently pretending to
                    have worked — the disclosed trade-off of true optimistic
                    updates, not a lie. Edit/Delete are disabled above while
                    pending since a temp id has nothing real yet to target. */}
                <div className={cx("bg-[var(--color-surface)] py-0.5", todo.pending && "opacity-50")}>
                  <div className="flex items-center gap-2.5 text-sm">
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={todo.completed}
                      aria-label={todo.text}
                      disabled={todo.pending}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => onToggle(todo.id, !todo.completed)}
                      className={cx(
                        "grid h-[19px] w-[19px] flex-none place-items-center rounded-md border-2 text-[var(--color-accent-ink)]",
                        todo.pending ? "cursor-not-allowed" : "cursor-pointer",
                        todo.completed
                          ? "border-[var(--color-good)] bg-[var(--color-good)]"
                          : "border-[var(--color-line)] bg-transparent",
                      )}
                    >
                      {todo.completed && <CheckIcon />}
                    </button>
                    <span
                      className={cx(
                        "flex-1 truncate",
                        todo.completed && "text-[var(--color-ink-soft)] line-through decoration-[var(--color-line)]",
                      )}
                    >
                      {todo.text}
                    </span>
                    {todo.notes && (
                      <button
                        type="button"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => toggleExpanded(todo.id)}
                        aria-label={expandedIds.has(todo.id) ? "Hide notes" : "Show notes"}
                        aria-expanded={expandedIds.has(todo.id)}
                        className={cx(
                          "flex-none cursor-pointer",
                          expandedIds.has(todo.id) ? "text-[var(--color-accent)]" : "text-[var(--color-ink-faint)]",
                        )}
                      >
                        <NoteIcon />
                      </button>
                    )}
                  </div>
                  {((todo.notes && expandedIds.has(todo.id)) || dueDateValue) && (
                    <div className="mt-1 flex flex-col gap-0.5 pl-[27px]">
                      {dueDateValue && (
                        <span
                          className={cx(
                            "flex w-fit items-center gap-1 text-[0.68rem] font-semibold",
                            overdue ? "text-[var(--color-accent)]" : "text-[var(--color-ink-faint)]",
                          )}
                        >
                          <CalendarIcon />
                          Due {format(parseDueDate(dueDateValue), "EEE, MMM d")}
                          {overdue && " · overdue"}
                        </span>
                      )}
                      {todo.notes && expandedIds.has(todo.id) && (
                        <p className="text-xs leading-relaxed text-[var(--color-ink-soft)]">{todo.notes}</p>
                      )}
                    </div>
                  )}
                </div>
              </SwipeRevealRow>
            </li>
          );
        })}
        {visibleTodos.length === 0 && todos.length === 0 && (
          <li className="text-xs text-[var(--color-ink-faint)] italic">Nothing on the list right now.</li>
        )}
        {visibleTodos.length === 0 && todos.length > 0 && (
          <li className="text-xs text-[var(--color-ink-faint)] italic">Everything's done. Nice.</li>
        )}
      </ul>

      {/* Item 3, moved (direct feedback): the consolidated hide-completed
          control now lives as a footer below the list, not in the header
          row next to the expand button. Still one control, two
          labels/states, same underlying `hideCompleted` boolean. */}
      <div className="mt-2 flex flex-none justify-end">
        <button
          type="button"
          onClick={() => updateHideCompleted(!hideCompleted)}
          className="cursor-pointer text-[0.68rem] font-semibold text-[var(--color-ink-faint)] underline decoration-dotted underline-offset-2"
        >
          {hideCompleted ? `${hiddenCount} completed hidden — show` : "Hide completed"}
        </button>
      </div>
    </section>
  );

  return (
    <>
      {sectionContent}
      {/* Portaled (not rendered inline) — TodoList is nested deep inside
          App.tsx's <main className="tablet-grid relative z-[1]">, which
          creates its own stacking context. A `position: fixed` descendant
          of a stacking-context-creating ancestor is capped at that
          ancestor's own stacking level no matter its own z-index — the
          exact trap VoiceButton.tsx hit and documented earlier this
          session. AddEventSheet doesn't need this itself only because it's
          mounted as a top-level App.tsx sibling, outside <main> entirely —
          not because portaling is unnecessary for a modal in general. */}
      {addModalOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 md:items-center md:p-6"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) closeAddModal();
            }}
            role="presentation"
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Add a to-do item"
              // Real bug, found via direct report with a screenshot: text
              // rendered black/invisible throughout this modal. Root cause —
              // `text-[var(--color-ink)]` (the default text color) is set on
              // App.tsx's own root <div>, not at :root/<html> — every other
              // element in the app inherits it by being a normal DOM
              // descendant of that div, but this modal is portaled directly
              // to document.body (a *sibling* of that div, not a descendant
              // — see the portal's own comment below), so it never inherited
              // that color at all and fell back to the browser default
              // (black), invisible against this dark surface. Explicit here
              // once, at the dialog's own root, so it correctly cascades to
              // everything inside via normal CSS inheritance — same fix
              // VoiceButton.tsx/HaDashboardButton.tsx already needed and
              // applied element-by-element; this is the one place it was
              // missed because this JSX was carried over from the original
              // non-portaled inline version, where the app root's own
              // inheritance already covered it.
              className="max-h-[88vh] w-full max-w-full overflow-y-auto rounded-t-[20px] bg-[var(--color-surface)] p-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] text-[var(--color-ink)] shadow-2xl md:max-w-[380px] md:rounded-[var(--radius-panel)] md:p-6"
            >
              <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-[var(--color-line)] md:hidden" aria-hidden="true" />

              <div className="mb-4 flex items-center justify-between">
                <p className="text-base font-bold" style={{ fontFamily: "var(--font-display)" }}>
                  Add to{" "}
                  {listScope === "shared" ? "Shared" : listScope === eric?.id ? "Eric's" : "Lindsay's"} list
                </p>
                <button
                  type="button"
                  onClick={closeAddModal}
                  aria-label="Close"
                  className="grid h-[26px] w-[26px] flex-none cursor-pointer place-items-center rounded-full bg-[var(--color-bg)] text-[var(--color-ink-soft)]"
                >
                  &times;
                </button>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  submit();
                }}
                className="mb-1.5 flex items-center gap-2 rounded-full border border-[var(--color-line)] bg-[var(--color-bg)] py-1 pr-1 pl-3"
              >
                <input
                  ref={addInputRef}
                  value={text}
                  autoFocus
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Add an item…"
                  aria-label="Add a to-do item"
                  enterKeyHint="send"
                  // text-base (16px), not text-sm — real bug, direct
                  // request: iOS Safari auto-zooms the whole page on focus
                  // when a form element's font-size is under 16px. This is
                  // the field people actually type into most, so it's the
                  // one most likely to have been triggering it.
                  className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-[var(--color-ink-faint)]"
                />
                <button
                  type="submit"
                  aria-label={text.trim() ? "Send" : "Add item"}
                  // Real bug, found via direct report: adding several items
                  // in a row (without closing the modal) caused a visible
                  // flash, the keyboard dropping and reopening, and the
                  // page scrolling somewhere unpredictable each time.
                  // Root cause — tapping any <button> naturally shifts
                  // focus to it first, by default browser behavior, which
                  // blurs the text input a moment before submit()'s own
                  // setTimeout(...).focus() call claws it back — the
                  // keyboard visibly dismisses and reopens, and each
                  // fresh focus event re-triggers the browser's own
                  // "scroll the focused input into view" heuristic,
                  // landing the page somewhere different each time.
                  // preventDefault() on pointerdown/mousedown stops that
                  // default focus-shift *before* it happens (a standard
                  // technique for exactly this — send buttons in chat UIs
                  // do the same) while the click/submit still fires
                  // normally right after — the input now simply never
                  // loses focus for a keyboard-driven Enter or a tap here.
                  onPointerDown={(e) => e.preventDefault()}
                  onMouseDown={(e) => e.preventDefault()}
                  // 44px, not the original 22px — direct request, matches
                  // the ~44px minimum tap-target guideline (Apple HIG/
                  // Android's own 48dp). Unlike the trigger's decorative
                  // circle, this one is a real, standalone tap target —
                  // the Enter key works too, but for anyone tapping
                  // instead, 22px was genuinely small to hit reliably.
                  className="grid h-11 w-11 flex-none cursor-pointer place-items-center rounded-full bg-[var(--color-accent)] text-sm leading-none font-bold text-[var(--color-accent-ink)]"
                >
                  {text.trim() ? <SendIcon /> : "+"}
                </button>
              </form>

              {addError && (
                <p className="mb-1.5 rounded-lg bg-[var(--color-accent)]/10 px-2.5 py-1.5 text-[0.68rem] text-[var(--color-accent)]">
                  {addError}
                </p>
              )}

              {detailsOpen ? (
                <div className="flex flex-col gap-1.5 rounded-lg border border-dashed border-[var(--color-line)] p-2">
                  <label className="flex flex-col gap-1">
                    <span className="text-[0.6rem] font-semibold text-[var(--color-ink-faint)]">Notes (optional)</span>
                    <textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Notes…"
                      rows={2}
                      className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 py-1.5 text-base leading-relaxed outline-none placeholder:text-[var(--color-ink-faint)]"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[0.6rem] font-semibold text-[var(--color-ink-faint)]">Due date (optional)</span>
                    <input
                      type="date"
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                      className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 py-1.5 text-base outline-none"
                    />
                  </label>
                  {(eric || lindsay) && (
                    <div className="flex flex-col gap-1">
                      <span className="text-[0.6rem] font-semibold text-[var(--color-ink-faint)]">List</span>
                      <div className="flex flex-wrap gap-1.5">
                        <ListScopeChip person={null} active={addScope === "shared"} onClick={() => setAddScope("shared")} />
                        {eric && (
                          <ListScopeChip person={eric} active={addScope === eric.id} onClick={() => setAddScope(eric.id)} />
                        )}
                        {lindsay && (
                          <ListScopeChip
                            person={lindsay}
                            active={addScope === lindsay.id}
                            onClick={() => setAddScope(lindsay.id)}
                          />
                        )}
                      </div>
                      {addScope !== "shared" && (
                        <label className="mt-0.5 flex items-center gap-1.5 text-[0.66rem] text-[var(--color-ink-soft)]">
                          <input
                            type="checkbox"
                            checked={addAlsoShared}
                            onChange={(e) => setAddAlsoShared(e.target.checked)}
                            className="h-3.5 w-3.5 cursor-pointer accent-[var(--color-accent)]"
                          />
                          Also show in Shared
                        </label>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setDetailsOpen(true)}
                  className="cursor-pointer self-start text-[0.68rem] font-semibold text-[var(--color-ink-faint)] underline decoration-dotted underline-offset-2"
                >
                  + add details
                </button>
              )}
              {detailsOpen && (
                <button
                  type="button"
                  onClick={() => {
                    setDetailsOpen(false);
                    setNotes("");
                    setDueDate("");
                    setAddScope(listScope);
                    setAddAlsoShared(false);
                  }}
                  className="cursor-pointer self-start text-[0.68rem] font-semibold text-[var(--color-ink-faint)] underline decoration-dotted underline-offset-2"
                >
                  − hide details
                </button>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
