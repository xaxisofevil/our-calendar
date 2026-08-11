import { useCallback, useEffect, useRef } from "react";

// Tablet expand/collapse (this pass): a kiosk safety net for someone who
// expands a card (Calendar / Day List / To-Do) into its modal and walks
// away — auto-collapse back to the default layout after this much genuine
// inactivity. Not a flat timer from expand-time: any interaction inside the
// expanded modal (scroll, tap, typing, adding an item) resets the window,
// via the `bump` callback this hook returns.
const AUTO_COLLAPSE_MS = 3 * 60 * 1000;

/**
 * `active` toggles the whole mechanism on/off (pass `expandedPanel !== null`
 * — there's nothing to auto-collapse when nothing is expanded). `onIdle`
 * fires once, after AUTO_COLLAPSE_MS with no `bump()` call, while active.
 * Returns `bump`, meant to be wired to onPointerDown/onScroll/onKeyDown (or
 * called directly) on whatever's currently expanded.
 */
export function useAutoCollapse(active: boolean, onIdle: () => void): () => void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle;

  const bump = useCallback(() => {
    if (timerRef.current != null) clearTimeout(timerRef.current);
    timerRef.current = null;
    if (active) {
      timerRef.current = setTimeout(() => onIdleRef.current(), AUTO_COLLAPSE_MS);
    }
  }, [active]);

  // (Re)start the window whenever `active` flips true (a card was just
  // expanded), and clear it outright once `active` goes false (collapsed,
  // nothing to time out anymore).
  useEffect(() => {
    bump();
    return () => {
      if (timerRef.current != null) clearTimeout(timerRef.current);
    };
  }, [bump]);

  return bump;
}
