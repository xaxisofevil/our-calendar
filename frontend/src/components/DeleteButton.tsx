import { cx } from "../lib/cx";

interface DeleteButtonProps {
  label: string;
  onClick: () => void;
  className?: string;
}

/**
 * M2 discoverability fix (ARCHITECTURE.md §14): the M1 delete affordance was
 * opacity-0-until-`:hover`, which is invisible by construction on the
 * fridge tablet and iPhone — touchscreens have no hover state, so there was
 * no way to discover it at all in real use, not just a "hard to notice"
 * problem. This version is always visible, given a real ~28px circular
 * touch target instead of a bare glyph, and kept visually quiet (muted
 * outline, not red) so it reads as "available" rather than "dangerous" at
 * a glance — consistent with the calm/home tone, just no longer hidden.
 */
export function DeleteButton({ label, onClick, className }: DeleteButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cx(
        "grid h-7 w-7 flex-none cursor-pointer place-items-center rounded-full border border-[var(--color-line)] bg-[var(--color-bg)] text-[var(--color-ink-faint)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]",
        className,
      )}
    >
      <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" aria-hidden="true">
        <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    </button>
  );
}
