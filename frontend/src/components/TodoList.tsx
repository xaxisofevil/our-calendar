import { useState } from "react";
import type { TodoRecord } from "../types";
import { cx } from "../lib/cx";

interface TodoListProps {
  todos: TodoRecord[];
  onAdd: (text: string, notes: string | null) => void;
  onToggle: (id: number, completed: boolean) => void;
  onDelete: (id: number) => void;
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

export function TodoList({ todos, onAdd, onToggle, onDelete }: TodoListProps) {
  const [text, setText] = useState("");
  const [notes, setNotes] = useState("");
  const [notesOpen, setNotesOpen] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  function submit() {
    const trimmed = text.trim();
    if (!trimmed) return;
    onAdd(trimmed, notes.trim() ? notes.trim() : null);
    setText("");
    setNotes("");
    setNotesOpen(false);
  }

  function toggleExpanded(id: number) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <section
      aria-label="Household to-do list"
      className="rounded-[var(--radius-panel)] bg-[var(--color-surface)] p-3.5 shadow-[0_1px_0_rgba(40,25,10,0.05),0_12px_26px_-18px_rgba(50,32,12,0.55)]"
    >
      <div className="mb-2.5">
        <p className="text-sm font-bold" style={{ fontFamily: "var(--font-display)" }}>
          Household
        </p>
        <p className="text-[0.66rem] text-[var(--color-ink-faint)]">Shared list — not tied to any date</p>
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

        {notesOpen ? (
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes (optional)…"
            rows={2}
            autoFocus
            className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-bg)] px-2.5 py-1.5 text-xs leading-relaxed outline-none placeholder:text-[var(--color-ink-faint)]"
          />
        ) : (
          <button
            type="button"
            onClick={() => setNotesOpen(true)}
            className="cursor-pointer self-start text-[0.68rem] font-semibold text-[var(--color-ink-faint)] underline decoration-dotted underline-offset-2"
          >
            + add notes
          </button>
        )}
      </div>

      <ul className="flex flex-col gap-1.5">
        {todos.map((todo) => (
          <li key={todo.id} className="group">
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
              <button
                type="button"
                onClick={() => onDelete(todo.id)}
                aria-label={`Delete ${todo.text}`}
                className="flex-none cursor-pointer text-[var(--color-ink-faint)] opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
              >
                &times;
              </button>
            </div>
            {todo.notes && expandedIds.has(todo.id) && (
              <p className="mt-1 pl-[27px] text-xs leading-relaxed text-[var(--color-ink-soft)]">{todo.notes}</p>
            )}
          </li>
        ))}
        {todos.length === 0 && (
          <li className="text-xs text-[var(--color-ink-faint)] italic">Nothing on the list right now.</li>
        )}
      </ul>
    </section>
  );
}
