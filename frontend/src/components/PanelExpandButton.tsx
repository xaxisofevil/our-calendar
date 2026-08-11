import { cx } from "../lib/cx";

interface PanelExpandButtonProps {
  expanded: boolean;
  onClick: () => void;
  /** Card name, e.g. "Calendar" / "Day List" / "To-Do" — used to build the
   * accessible label ("Expand Calendar" / "Collapse Calendar"). */
  label: string;
  className?: string;
}

// Diagonal-arrows-out (expand) / arrows-in (collapse) glyph, same visual
// language as the app's other small circular icon buttons (NavButton, the
// notification bell preview button in App.tsx).
function ExpandGlyph({ expanded }: { expanded: boolean }) {
  return (
    <svg viewBox="0 0 14 14" className="h-3 w-3" aria-hidden="true">
      {expanded ? (
        <path
          d="M8.5 5.5 12.5 1.5M8.5 5.5V2M8.5 5.5H12M5.5 8.5 1.5 12.5M5.5 8.5V12M5.5 8.5H2"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        <path
          d="M9 1.5H12.5V5M12.5 1.5 8.5 5.5M5 12.5H1.5V9M1.5 12.5 5.5 8.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

/**
 * Shared expand/collapse control for the three tablet (md+) cards —
 * Calendar, Day List, To-Do. One button, one handler: tapping it while
 * collapsed opens that card's modal (see ExpandedPanelModal), tapping it
 * again (rendered inside the modal, `expanded` now true) collapses back to
 * the default layout — satisfies "every expanded card needs an explicit
 * collapse button" without a second, differently-styled control.
 */
export function PanelExpandButton({ expanded, onClick, label, className }: PanelExpandButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={expanded ? `Collapse ${label}` : `Expand ${label}`}
      title={expanded ? "Collapse" : "Expand"}
      className={cx(
        "grid h-7 w-7 flex-none cursor-pointer place-items-center rounded-full border border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-ink-soft)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]",
        className,
      )}
    >
      <ExpandGlyph expanded={expanded} />
    </button>
  );
}
