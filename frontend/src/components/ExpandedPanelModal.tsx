import { useEffect, type ReactNode } from "react";
import { cx } from "../lib/cx";

interface ExpandedPanelModalProps {
  open: boolean;
  label: string;
  /** Tailwind width/height utility classes (md-scoped) sizing the modal —
   * Day List/To-Do use 50vw/50vh per spec ("grows to 50% of the screen");
   * Calendar's default is already 50% of the screen width, so its expanded
   * modal is sized a bit more generously (judgment call, not literally
   * "50vw" again, which wouldn't read as an expansion at all). */
  widthClassName: string;
  heightClassName: string;
  onCollapse: () => void;
  /** Any interaction inside the modal resets the 3-minute auto-collapse
   * idle timer (ARCHITECTURE.md-style kiosk safety net) — see
   * lib/useAutoCollapse.ts. */
  onActivity: () => void;
  children: ReactNode;
}

/**
 * Tablet-only (md+) expand target: dragging a card open via
 * PanelExpandButton renders its content here instead of in its default
 * slot — a dismissible modal overlay, not a resize of the underlying
 * layout, so it's visually unambiguous that this is a focused mode. Mirrors
 * the existing AddEventSheet backdrop/dialog pattern for consistency
 * (fixed inset-0 backdrop, click-outside-to-close, Escape-to-close).
 */
export function ExpandedPanelModal({
  open,
  label,
  widthClassName,
  heightClassName,
  onCollapse,
  onActivity,
  children,
}: ExpandedPanelModalProps) {
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCollapse();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onCollapse]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 hidden items-center justify-center bg-black/40 p-6 md:flex"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCollapse();
      }}
      onPointerDown={onActivity}
      onScroll={onActivity}
      onKeyDown={onActivity}
    >
      {/* No bg/rounded/shadow of its own — MonthGrid/DayDetailPanel/TodoList
          already render as a full "card" (same styling whether in their
          default slot or here), so this stays a bare sizing/positioning
          wrapper to avoid a card-inside-a-card double border. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={cx("flex max-h-[92vh] min-h-0 w-full max-w-[92vw] flex-col drop-shadow-2xl", widthClassName, heightClassName)}
      >
        {children}
      </div>
    </div>
  );
}
