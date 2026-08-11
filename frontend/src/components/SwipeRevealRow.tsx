import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { cx } from "../lib/cx";

// Width of the revealed actions strip (Edit + Delete) — kept as one
// constant shared between the clamp math below and the actions panel's own
// width class, so "fully open" always matches exactly what's visible.
const REVEAL_WIDTH_PX = 132;
// A pointer move shorter than this (in either axis) still counts as a tap,
// not a drag — standard swipe-list tap/drag disambiguation.
const TAP_SLOP_PX = 8;
// How far past REVEAL_WIDTH_PX (as a fraction) a drag must clear before
// release snaps it open instead of springing back closed.
const OPEN_THRESHOLD = 0.4;

interface SwipeRevealRowProps {
  /** Controlled: is this row's reveal currently open? Lifted to the parent
   * list (DayDetailPanel/TodoList) so opening one row can close any other
   * currently-open row (only one open at a time) and so "tap elsewhere
   * closes it" can be implemented at the list level. */
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fires on a genuine tap (movement stayed under TAP_SLOP_PX) while the
   * row was closed — e.g. opens the existing edit sheet. Unchanged from
   * the pre-swipe behavior: tapping the row still edits it. */
  onTap: () => void;
  /** Edit/Delete buttons revealed to the left, under where the content used
   * to start, once dragged/pulled open to the right. */
  actions: ReactNode;
  children: ReactNode;
  ariaLabel?: string;
}

/**
 * Replaces the old always-visible circular delete button on event/todo rows
 * (too easy to hit by accident on a touchscreen) with a swipe-right-to-
 * reveal gesture, closer to standard swipe-list UX: drag the row's content
 * to the right to reveal Edit/Delete underneath; release past a threshold
 * to snap open, short of it to spring back closed. Tap-to-edit (the row's
 * existing behavior) is preserved unchanged — this only adds a second way
 * to reach Edit, and moves Delete out of the always-visible spot.
 *
 * Pointer Events (not touch-only) so mouse works too, per spec — real
 * drag handling, testable the same way in Playwright via page.mouse.
 */
export function SwipeRevealRow({ isOpen, onOpenChange, onTap, actions, children, ariaLabel }: SwipeRevealRowProps) {
  const [dragX, setDragX] = useState<number | null>(null); // non-null only while an active gesture is in progress
  const startRef = useRef<{ x: number; y: number; base: number } | null>(null);
  const draggingRef = useRef(false); // has this gesture moved past tap-slop?

  const restingOffset = isOpen ? REVEAL_WIDTH_PX : 0;
  const offset = dragX ?? restingOffset;

  function handlePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    // Only the primary button/touch/pen — ignore secondary mouse buttons.
    if (e.button != null && e.button !== 0) return;
    startRef.current = { x: e.clientX, y: e.clientY, base: restingOffset };
    draggingRef.current = false;
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const start = startRef.current;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (!draggingRef.current) {
      if (Math.abs(dx) < TAP_SLOP_PX && Math.abs(dy) < TAP_SLOP_PX) return;
      // A predominantly vertical move (e.g. scrolling the list) isn't a
      // swipe attempt — let it fall through as neither a tap nor a drag.
      if (Math.abs(dy) > Math.abs(dx)) {
        startRef.current = null;
        return;
      }
      draggingRef.current = true;
    }
    const next = Math.max(0, Math.min(REVEAL_WIDTH_PX, start.base + dx));
    setDragX(next);
  }

  function endDrag(e: ReactPointerEvent<HTMLDivElement>) {
    const start = startRef.current;
    startRef.current = null;
    (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);

    if (!start) return;

    if (!draggingRef.current) {
      // A genuine tap. Tapping an already-open row closes the reveal
      // instead of firing onTap — avoids accidentally triggering edit
      // while dismissing an open swipe.
      setDragX(null);
      if (isOpen) onOpenChange(false);
      else onTap();
      return;
    }

    draggingRef.current = false;
    const finalOffset = dragX ?? restingOffset;
    setDragX(null);
    onOpenChange(finalOffset >= REVEAL_WIDTH_PX * OPEN_THRESHOLD);
  }

  function handleKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (isOpen) onOpenChange(false);
      else onTap();
    }
  }

  return (
    <div className="relative overflow-hidden rounded-lg">
      <div
        className="absolute inset-y-0 left-0 flex items-stretch gap-1 pr-1.5"
        style={{ width: REVEAL_WIDTH_PX }}
        aria-hidden={!isOpen}
      >
        {actions}
      </div>
      <div
        role="button"
        tabIndex={0}
        aria-label={ariaLabel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={handleKeyDown}
        className={cx(
          "relative touch-pan-y cursor-pointer outline-none select-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]",
          dragX === null && "transition-transform duration-200 ease-out",
        )}
        style={{ transform: `translateX(${offset}px)` }}
      >
        {children}
      </div>
    </div>
  );
}
