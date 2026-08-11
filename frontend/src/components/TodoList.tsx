import { useMemo, useState } from "react";
import { format } from "date-fns";
import type { TodoRecord } from "../types";
import { cx } from "../lib/cx";
import { DeleteButton } from "./DeleteButton";

interface TodoListProps {
  todos: TodoRecord[];
  /** Message from the create-todo mutation, if it failed server-side (e.g.
   * text over the 500-char limit) — see ARCHITECTURE.md M2 bug report #3. */
  addError?: string | null;
  onAdd: (text: string, notes: string | null, dueDate: string | null) => void;
  onToggle: (id: number, completed: boolean) => void;
  onDelete: (id: number) => void;
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

export function TodoList({ todos, addError, onAdd, onToggle, onDelete }: TodoListProps) {
  const [text, setText] = useState("");
  const [notes, setNotes] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [hideCompleted, setHideCompleted] = useState(readHideCompleted);

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
      className="rounded-[var(--radius-panel)] bg-[var(--color-surface)] p-3.5 shadow-[0_1px_0_rgba(40,25,10,0.05),0_12px_26px_-18px_rgba(50,32,12,0.55)]"
    >
      <div className="mb-2.5 flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-bold" style={{ fontFamily: "var(--font-display)" }}>
            Household
          </p>
          <p className="text-[0.66rem] text-[var(--color-ink-faint)]">Shared list — not tied to any date</p>
        </div>
        <label className="flex flex-none items-center gap-1.5">
          <span className="text-[0.62rem] font-semibold text-[var(--color-ink-faint)]">Hide completed</span>
          <input
            type="checkbox"
            className="toggle-switch"
            checked={hideCompleted}
            onChange={(e) => updateHideCompleted(e.target.checked)}
            aria-label="Hide completed items"
          />
        </label>
      </div>

      <div className="mb-3 flex flex-col gap-1.5">
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

      <ul className="flex flex-col gap-1.5">
        {sortedTodos.map((todo) => {
          const dueDateValue = todo.dueAt;
          const overdue = dueDateValue ? !todo.completed && isOverdue(dueDateValue) : false;
          return (
            <li key={todo.id}>
              <div className="flex items-center gap-2.5 text-sm">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={todo.completed}
                  aria-label={todo.text}
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
                <DeleteButton label={`Delete ${todo.text}`} onClick={() => onDelete(todo.id)} />
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

      {hideCompleted && hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => updateHideCompleted(false)}
          className="mt-2 cursor-pointer text-[0.68rem] font-semibold text-[var(--color-ink-faint)] underline decoration-dotted underline-offset-2"
        >
          {hiddenCount} completed hidden — show
        </button>
      )}
    </section>
  );
}
