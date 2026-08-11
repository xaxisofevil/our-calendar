import { useEffect, useId, useState } from "react";
import { format } from "date-fns";
import { cx } from "../lib/cx";
import { dayDetailLabel } from "../lib/dateUtils";
import { defaultRepeatValue, type RepeatValue } from "../lib/recurrence";
import { RepeatField } from "./RepeatField";
import type { CreateEventInput, EventRecord, PersonRecord } from "../types";

interface AddEventSheetProps {
  open: boolean;
  selectedDate: Date;
  people: PersonRecord[];
  /** When set, the sheet opens in edit mode for this event instead of
   * create mode — same component, aware of which mode it's in (see
   * ARCHITECTURE.md M2 delete-affordance follow-up: editing was the other
   * half of that gap). Null/undefined means "creating a new event". */
  editingEvent?: EventRecord | null;
  onClose: () => void;
  /** Called on save with the built payload. `editingId` is the id being
   * edited (edit mode) or undefined (create mode) — one callback, one
   * component, App.tsx routes it to the right mutation. */
  onSave: (input: CreateEventInput, editingId?: number) => void;
}

function combineDateAndTime(date: Date, timeStr: string): Date {
  const [hours, minutes] = timeStr.split(":").map(Number);
  const combined = new Date(date);
  combined.setHours(hours || 0, minutes || 0, 0, 0);
  return combined;
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function AddEventSheet({ open, selectedDate, people, editingEvent, onClose, onSave }: AddEventSheetProps) {
  const titleId = useId();
  const isEditing = editingEvent != null;
  // The date the sheet operates on: the editing event's own date when
  // editing (so a stale `selectedDate` in the parent can never silently
  // move the event), otherwise whichever day was tapped to add to.
  const effectiveDate = editingEvent ? new Date(editingEvent.startAt) : selectedDate;
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [startTime, setStartTime] = useState("15:00");
  const [endTime, setEndTime] = useState("16:00");
  const [personId, setPersonId] = useState<number | null>(null);
  // M2 UI-only mock (ARCHITECTURE.md §7a / §14) — visually complete, not
  // persisted. Nothing here is sent in the onSave payload below, in either
  // create or edit mode.
  const [repeat, setRepeat] = useState<RepeatValue>(() => defaultRepeatValue(selectedDate));

  // Reset every time the sheet opens: to the event's current values when
  // editing, or to a clean slate when creating (per the validated mockup's
  // behavior — each add starts fresh rather than remembering the last
  // draft). Person defaults to the first seeded person, not "no one".
  useEffect(() => {
    if (!open) return;
    if (editingEvent) {
      setTitle(editingEvent.title);
      setDescription(editingEvent.description ?? "");
      setAllDay(editingEvent.allDay);
      setStartTime(format(new Date(editingEvent.startAt), "HH:mm"));
      setEndTime(format(new Date(editingEvent.endAt), "HH:mm"));
      setPersonId(editingEvent.personId);
      setRepeat(defaultRepeatValue(new Date(editingEvent.startAt)));
    } else {
      setTitle("");
      setDescription("");
      setAllDay(false);
      setStartTime("15:00");
      setEndTime("16:00");
      setPersonId(people[0]?.id ?? null);
      setRepeat(defaultRepeatValue(selectedDate));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editingEvent]);

  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  function handleSave() {
    const trimmedTitle = title.trim() || "Untitled event";
    let startAt: Date;
    let endAt: Date;
    if (allDay) {
      startAt = startOfDay(effectiveDate);
      endAt = new Date(startAt);
      endAt.setDate(endAt.getDate() + 1);
    } else {
      startAt = combineDateAndTime(effectiveDate, startTime);
      endAt = combineDateAndTime(effectiveDate, endTime);
      if (endAt <= startAt) endAt = new Date(startAt.getTime() + 60 * 60_000);
    }
    onSave(
      {
        title: trimmedTitle,
        description: description.trim() ? description.trim() : null,
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        allDay,
        personId,
      },
      editingEvent?.id,
    );
  }

  return (
    <div
      className={cx(
        "fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 transition-opacity duration-200 ease-out md:items-center md:p-6",
        open ? "opacity-100" : "pointer-events-none opacity-0",
      )}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cx(
          "max-h-[88vh] w-full max-w-full overflow-y-auto rounded-t-[20px] bg-[var(--color-surface)] p-5 pb-6 shadow-2xl transition-transform duration-200 ease-out md:max-w-[380px] md:rounded-[var(--radius-panel)] md:p-6",
          open ? "translate-y-0 md:scale-100 md:opacity-100" : "translate-y-full md:translate-y-0 md:scale-95 md:opacity-0",
        )}
      >
        <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-[var(--color-line)] md:hidden" aria-hidden="true" />

        <div className="mb-4 flex items-center justify-between">
          <p id={titleId} className="text-base font-bold" style={{ fontFamily: "var(--font-display)" }}>
            {isEditing ? "Edit event" : "New event"}
          </p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-[26px] w-[26px] flex-none cursor-pointer place-items-center rounded-full bg-[var(--color-bg)] text-[var(--color-ink-soft)]"
          >
            &times;
          </button>
        </div>

        <label className="mb-3 flex flex-col gap-1">
          <span className="text-[0.66rem] font-bold tracking-wide text-[var(--color-ink-soft)] uppercase">
            Title
          </span>
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Piano lesson"
            className="w-full rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-bg)] px-2.5 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
          />
        </label>

        <div className="mb-3 flex flex-col gap-1">
          <span className="text-[0.66rem] font-bold tracking-wide text-[var(--color-ink-soft)] uppercase">
            Date
          </span>
          <div className="w-full rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-bg)] px-2.5 py-2 text-sm text-[var(--color-ink-soft)]">
            {dayDetailLabel(effectiveDate)}
          </div>
        </div>

        {people.length > 0 && (
          <div className="mb-3 flex flex-col gap-1.5">
            <span className="text-[0.66rem] font-bold tracking-wide text-[var(--color-ink-soft)] uppercase">
              For
            </span>
            <div className="flex flex-wrap gap-1.5">
              {people.map((person) => {
                const active = personId === person.id;
                return (
                  <button
                    key={person.id}
                    type="button"
                    onClick={() => setPersonId(person.id)}
                    aria-pressed={active}
                    className={cx(
                      "flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs font-bold transition-colors",
                      active ? "border-transparent text-white" : "border-[var(--color-line)] text-[var(--color-ink-soft)]",
                    )}
                    style={active ? { backgroundColor: person.color } : undefined}
                  >
                    <span
                      className="h-2 w-2 flex-none rounded-full"
                      style={{ backgroundColor: active ? "rgba(255,255,255,0.85)" : person.color }}
                      aria-hidden="true"
                    />
                    {person.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <label className="mb-3 flex flex-row items-center justify-between">
          <span className="text-[0.66rem] font-bold tracking-wide text-[var(--color-ink-soft)] uppercase">
            All day
          </span>
          <input
            type="checkbox"
            className="toggle-switch"
            checked={allDay}
            onChange={(e) => setAllDay(e.target.checked)}
          />
        </label>

        {!allDay && (
          <div className="mb-3 flex gap-2.5">
            <label className="flex flex-1 flex-col gap-1">
              <span className="text-[0.66rem] font-bold tracking-wide text-[var(--color-ink-soft)] uppercase">
                Starts
              </span>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-bg)] px-2.5 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
              />
            </label>
            <label className="flex flex-1 flex-col gap-1">
              <span className="text-[0.66rem] font-bold tracking-wide text-[var(--color-ink-soft)] uppercase">
                Ends
              </span>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-bg)] px-2.5 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
              />
            </label>
          </div>
        )}

        {/* Repeats: mirrors Google Calendar's picker per ARCHITECTURE.md
            §7a. UI-only for this pass — see the `repeat` state comment
            above; nothing here is persisted yet. */}
        <RepeatField anchor={effectiveDate} value={repeat} onChange={setRepeat} />

        {/* Notes: plain, visually secondary field below the main fields —
            optional, so it never adds friction to "just add a title and go." */}
        <label className="mb-4 flex flex-col gap-1">
          <span className="text-[0.64rem] font-semibold text-[var(--color-ink-faint)]">Notes (optional)</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. leave by 2:30, bring the insurance card…"
            rows={2}
            className="w-full rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-bg)] px-2.5 py-1.5 text-xs leading-relaxed outline-none placeholder:text-[var(--color-ink-faint)] focus:border-[var(--color-accent)]"
          />
        </label>

        <div className="flex justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-full border border-[var(--color-line)] px-4 py-2 text-sm font-bold text-[var(--color-ink-soft)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="cursor-pointer rounded-full bg-[var(--color-accent)] px-4.5 py-2 text-sm font-bold text-[var(--color-accent-ink)]"
          >
            {isEditing ? "Save changes" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
