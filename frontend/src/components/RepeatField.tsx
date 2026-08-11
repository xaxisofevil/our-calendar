import { useEffect, useRef, useState } from "react";
import { cx } from "../lib/cx";
import {
  WEEKDAY_SHORT_LABELS,
  defaultCustomRepeat,
  repeatQuickOptions,
  summarizeRepeat,
  type CustomUnit,
  type RepeatFreq,
  type RepeatValue,
} from "../lib/recurrence";

interface RepeatFieldProps {
  anchor: Date;
  value: RepeatValue;
  onChange: (value: RepeatValue) => void;
}

const UNIT_OPTIONS: CustomUnit[] = ["day", "week", "month", "year"];

function ChevronIcon() {
  return (
    <svg viewBox="0 0 10 6" className="h-1.5 w-2.5 flex-none" aria-hidden="true">
      <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function RepeatField({ anchor, value, onChange }: RepeatFieldProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const options = repeatQuickOptions(anchor);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  function pickFreq(freq: RepeatFreq) {
    if (freq === "custom") {
      onChange({ freq, custom: value.custom.weekdays.length ? value.custom : defaultCustomRepeat(anchor) });
    } else {
      onChange({ ...value, freq });
    }
    setOpen(false);
  }

  function toggleWeekday(day: number) {
    const has = value.custom.weekdays.includes(day);
    const weekdays = has ? value.custom.weekdays.filter((d) => d !== day) : [...value.custom.weekdays, day];
    onChange({ ...value, custom: { ...value.custom, weekdays } });
  }

  return (
    <div className="mb-3 flex flex-col gap-1" ref={rootRef}>
      <span className="text-[0.66rem] font-bold tracking-wide text-[var(--color-ink-soft)] uppercase">Repeats</span>

      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="listbox"
          aria-expanded={open}
          className="flex w-full items-center justify-between gap-2 rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-bg)] px-2.5 py-2 text-left text-sm outline-none focus:border-[var(--color-accent)]"
        >
          <span className="truncate">{summarizeRepeat(value, anchor)}</span>
          <ChevronIcon />
        </button>

        {open && (
          <ul
            role="listbox"
            className="absolute inset-x-0 top-[calc(100%+4px)] z-10 overflow-hidden rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-surface)] py-1 shadow-lg"
          >
            {options.map((option) => (
              <li key={option.value}>
                <button
                  type="button"
                  role="option"
                  aria-selected={value.freq === option.value}
                  onClick={() => pickFreq(option.value)}
                  className={cx(
                    "w-full cursor-pointer px-3 py-2 text-left text-sm",
                    value.freq === option.value ? "bg-[var(--color-bg)] font-bold" : "hover:bg-[var(--color-bg)]",
                  )}
                >
                  {option.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {value.freq === "custom" && (
        <div className="mt-2 flex flex-col gap-3 rounded-[var(--radius-control)] border border-dashed border-[var(--color-line)] bg-[var(--color-bg)] p-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-[var(--color-ink-soft)]">Every</span>
            <input
              type="number"
              min={1}
              max={99}
              value={value.custom.interval}
              onChange={(e) =>
                onChange({
                  ...value,
                  custom: { ...value.custom, interval: Math.max(1, Number(e.target.value) || 1) },
                })
              }
              className="w-14 rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-1 text-center text-sm outline-none focus:border-[var(--color-accent)]"
            />
            <select
              value={value.custom.unit}
              onChange={(e) => onChange({ ...value, custom: { ...value.custom, unit: e.target.value as CustomUnit } })}
              className="rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-1 text-sm outline-none focus:border-[var(--color-accent)]"
            >
              {UNIT_OPTIONS.map((unit) => (
                <option key={unit} value={unit}>
                  {unit}
                  {value.custom.interval === 1 ? "" : "s"}
                </option>
              ))}
            </select>
          </div>

          {value.custom.unit === "week" && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[0.64rem] font-semibold text-[var(--color-ink-faint)]">Repeat on</span>
              <div className="flex gap-1">
                {WEEKDAY_SHORT_LABELS.map((label, day) => {
                  const active = value.custom.weekdays.includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      onClick={() => toggleWeekday(day)}
                      aria-pressed={active}
                      aria-label={label}
                      className={cx(
                        "grid h-7 w-7 flex-none cursor-pointer place-items-center rounded-full text-[0.68rem] font-bold transition-colors",
                        active
                          ? "bg-[var(--color-accent)] text-[var(--color-accent-ink)]"
                          : "border border-[var(--color-line)] text-[var(--color-ink-soft)]",
                      )}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <span className="text-[0.64rem] font-semibold text-[var(--color-ink-faint)]">Ends</span>
            <label className="flex items-center gap-2 text-xs text-[var(--color-ink-soft)]">
              <input
                type="radio"
                name="repeat-end"
                className="accent-[var(--color-accent)]"
                checked={value.custom.end.type === "never"}
                onChange={() => onChange({ ...value, custom: { ...value.custom, end: { type: "never" } } })}
              />
              Never
            </label>
            <label className="flex items-center gap-2 text-xs text-[var(--color-ink-soft)]">
              <input
                type="radio"
                name="repeat-end"
                className="accent-[var(--color-accent)]"
                checked={value.custom.end.type === "on"}
                onChange={() =>
                  onChange({ ...value, custom: { ...value.custom, end: { type: "on", date: "" } } })
                }
              />
              On
              <input
                type="date"
                disabled={value.custom.end.type !== "on"}
                value={value.custom.end.type === "on" ? value.custom.end.date : ""}
                onChange={(e) => onChange({ ...value, custom: { ...value.custom, end: { type: "on", date: e.target.value } } })}
                className="rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-1 text-xs outline-none focus:border-[var(--color-accent)] disabled:opacity-50"
              />
            </label>
            <label className="flex items-center gap-2 text-xs text-[var(--color-ink-soft)]">
              <input
                type="radio"
                name="repeat-end"
                className="accent-[var(--color-accent)]"
                checked={value.custom.end.type === "after"}
                onChange={() => onChange({ ...value, custom: { ...value.custom, end: { type: "after", count: 5 } } })}
              />
              After
              <input
                type="number"
                min={1}
                max={365}
                disabled={value.custom.end.type !== "after"}
                value={value.custom.end.type === "after" ? value.custom.end.count : 5}
                onChange={(e) =>
                  onChange({
                    ...value,
                    custom: { ...value.custom, end: { type: "after", count: Math.max(1, Number(e.target.value) || 1) } },
                  })
                }
                className="w-14 rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-1 text-center text-xs outline-none focus:border-[var(--color-accent)] disabled:opacity-50"
              />
              occurrences
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
