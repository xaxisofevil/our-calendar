import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import type { TodoRecord } from "../types";
import { cx } from "../lib/cx";
import { PanelExpandButton } from "./PanelExpandButton";
import { SwipeRevealRow } from "./SwipeRevealRow";

export interface TodoEditInput {
  text: string;
  notes: string | null;
  dueAt: string | null;
}

interface TodoListProps {
  todos: TodoRecord[];
  /** Message from the create-todo mutation, if it failed server-side (e.g.
   * text over the 500-char limit) — see ARCHITECTURE.md M2 bug report #3. */
  addError?: string | null;
  onAdd: (text: string, notes: string | null, dueDate: string | null) => void;
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
  onSave,
  onCancel,
}: {
  todo: TodoRecord;
  onSave: (input: TodoEditInput) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(todo.text);
  const [notes, setNotes] = useState(todo.notes ?? "");
  const [dueDate, setDueDate] = useState(todo.dueAt ?? "");

  function save() {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSave({ text: trimmed, notes: notes.trim() ? notes.trim() : null, dueAt: dueDate || null });
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
          className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 py-1.5 text-sm outline-none focus:border-[var(--color-accent)]"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[0.6rem] font-semibold text-[var(--color-ink-faint)]">Notes (optional)</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          aria-label={`Edit notes for ${todo.text}`}
          className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 py-1.5 text-xs leading-relaxed outline-none"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[0.6rem] font-semibold text-[var(--color-ink-faint)]">Due date (optional)</span>
        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          aria-label={`Edit due date for ${todo.text}`}
          className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 py-1.5 text-xs outline-none"
        />
      </label>
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

export function TodoList({ todos, addError, onAdd, onToggle, onDelete, onEdit, expanded, onToggleExpand }: TodoListProps) {
  const [text, setText] = useState("");
  const [notes, setNotes] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [hideCompleted, setHideCompleted] = useState(readHideCompleted);
  const [openSwipeId, setOpenSwipeId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);

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
    onAdd(trimmed, notes.trim() ? notes.trim() : null, dueDate || null);
    setText("");
    setNotes("");
    setDueDate("");
    setDetailsOpen(false);
  }

  function toggleExpanded(id: number) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const visibleTodos = hideCompleted ? todos.filter((t) => !t.completed) : todos;
  const hiddenCount = todos.length - visibleTodos.length;

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

  return (
    <section
      aria-label="Household to-do list"
      className="rounded-[var(--radius-panel)] bg-[var(--color-surface)] p-3.5 shadow-[0_1px_0_rgba(40,25,10,0.05),0_12px_26px_-18px_rgba(50,32,12,0.55)] md:flex md:h-full md:flex-col"
    >
      <div className="mb-2.5 flex flex-none items-start justify-between gap-2">
        <div>
          <p className="font-bold" style={{ fontFamily: "var(--font-display)", fontSize: "var(--card-title-size)" }}>
            To-Do
          </p>
          <p className="text-[0.66rem] text-[var(--color-ink-faint)]">Shared list — not tied to any date</p>
        </div>
        {onToggleExpand && (
          <PanelExpandButton expanded={expanded ?? false} onClick={onToggleExpand} label="To-Do" className="hidden md:grid" />
        )}
      </div>

      <div className="mb-3 flex flex-none flex-col gap-1.5">
        <div className="flex items-center gap-2 rounded-full border border-[var(--color-line)] bg-[var(--color-bg)] py-1 pr-1.5 pl-3">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Add an item…"
            aria-label="Add a to-do item"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--color-ink-faint)]"
          />
          <button
            type="button"
            onClick={submit}
            aria-label="Add item"
            className="grid h-[22px] w-[22px] flex-none cursor-pointer place-items-center rounded-full bg-[var(--color-accent)] text-sm leading-none font-bold text-[var(--color-accent-ink)]"
          >
            +
          </button>
        </div>

        {addError && (
          <p className="rounded-lg bg-[var(--color-accent)]/10 px-2.5 py-1.5 text-[0.68rem] text-[var(--color-accent)]">
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
                autoFocus
                className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-bg)] px-2.5 py-1.5 text-xs leading-relaxed outline-none placeholder:text-[var(--color-ink-faint)]"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[0.6rem] font-semibold text-[var(--color-ink-faint)]">Due date (optional)</span>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-bg)] px-2.5 py-1.5 text-xs outline-none"
              />
            </label>
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
      </div>

      <ul className="flex flex-col gap-1.5 md:min-h-0 md:flex-1 md:overflow-y-auto">
        {sortedTodos.map((todo) => {
          const dueDateValue = todo.dueAt;
          const overdue = dueDateValue ? !todo.completed && isOverdue(dueDateValue) : false;

          if (editingId === todo.id) {
            return (
              <li key={todo.id}>
                <TodoEditForm
                  todo={todo}
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
                      onClick={() => {
                        setOpenSwipeId(null);
                        setEditingId(todo.id);
                      }}
                      aria-label={`Edit ${todo.text}`}
                      className="flex-1 cursor-pointer rounded-md bg-[var(--color-line)] text-xs font-bold text-[var(--color-ink-soft)]"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setOpenSwipeId(null);
                        onDelete(todo.id);
                      }}
                      aria-label={`Delete ${todo.text}`}
                      className="flex-1 cursor-pointer rounded-md bg-[var(--color-accent)]/15 text-xs font-bold text-[var(--color-accent)]"
                    >
                      Delete
                    </button>
                  </>
                }
              >
                <div className="bg-[var(--color-surface)] py-0.5">
                  <div className="flex items-center gap-2.5 text-sm">
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={todo.completed}
                      aria-label={todo.text}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => onToggle(todo.id, !todo.completed)}
                      className={cx(
                        "grid h-[19px] w-[19px] flex-none cursor-pointer place-items-center rounded-md border-2 text-[var(--color-accent-ink)]",
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
}
