import { type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { cx } from "../lib/cx";
import { useVoiceCapture } from "../lib/useVoiceCapture";

function MicIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" aria-hidden="true">
      <path
        d="M10 2.5a2.3 2.3 0 0 0-2.3 2.3v4.2a2.3 2.3 0 0 0 4.6 0V4.8A2.3 2.3 0 0 0 10 2.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path
        d="M5.5 9v.7a4.5 4.5 0 0 0 9 0V9M10 14.2v2.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

const STATUS_LABEL: Record<string, string> = {
  idle: "Hold to talk",
  recording: "Recording — release to send",
  uploading: "Transcribing…",
  commanding: "Working on it…",
  done: "Hold to talk again",
  error: "Hold to talk",
};

/**
 * ARCHITECTURE.md §9/§10 (M7/M8) — the push-to-talk mic button. Still
 * self-contained (unlike NotificationPrompt.tsx, whose open/dismiss/enable
 * state is lifted to App.tsx) — the whole capture/upload/command/display
 * state machine lives in useVoiceCapture and this component together, and
 * App.tsx just mounts `<VoiceButton />` in the header the same way it
 * mounts the bell-preview button next to it.
 *
 * Now shows the *result* of acting on a transcript, not just the
 * transcript itself (§9's original, deliberately-stopped-short scope):
 * what got created (with a plain Undo button, via the batch id — see
 * useVoiceCapture's `undoBatch`), a plain Confirm/Cancel pair for a
 * proposed destructive action awaiting confirmation, or a plain "nothing
 * to do" / error message. No auto-listening voice-driven confirmation
 * here on purpose — that's an explicit follow-up, not part of this pass;
 * confirming/cancelling here is always a manual tap.
 */
export function VoiceButton() {
  const {
    status,
    transcript,
    errorMessage,
    commandResult,
    actionNote,
    actionBusy,
    start,
    stop,
    reset,
    confirmAction,
    cancelAction,
    undoBatch,
    supported,
  } = useVoiceCapture();

  const recording = status === "recording";
  const busy = status === "uploading" || status === "commanding";
  const resultVisible = status === "done" || status === "error";

  function handlePressStart(e: ReactPointerEvent<HTMLButtonElement>) {
    if (e.button != null && e.button !== 0) return; // primary button/touch/pen only
    if (recording || busy) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    start();
  }

  function handlePressEnd(e: ReactPointerEvent<HTMLButtonElement>) {
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (status === "recording") stop();
  }

  return (
    <div className="relative">
      <button
        type="button"
        onPointerDown={handlePressStart}
        onPointerUp={handlePressEnd}
        onPointerCancel={handlePressEnd}
        aria-label={supported ? (STATUS_LABEL[status] ?? STATUS_LABEL.idle) : "Voice input isn't available on this browser"}
        aria-pressed={recording}
        className={cx(
          "grid h-7 w-7 flex-none cursor-pointer touch-none place-items-center rounded-full border text-sm transition-colors select-none",
          recording
            ? "animate-pulse border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-accent-ink)]"
            : busy
              ? "border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-ink-faint)]"
              : "border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-ink-soft)]",
        )}
      >
        <MicIcon />
      </button>

      {(busy || resultVisible) &&
        // Real bug, found via direct report: this first rendered as a small
        // panel directly under the button (absolute/top-full) — for a
        // press-and-hold header button, that's exactly where a thumb is
        // still hovering right after release, so it was effectively
        // invisible every time. Moved to a bottom-anchored toast (matching
        // NotificationPrompt.tsx's mobile toast) to get it away from the
        // thumb — which surfaced a *second*, real bug: `<header>` (App.tsx)
        // sets its own `relative` + explicit `z-[1]`, which creates a new
        // stacking context. Any `position: fixed` descendant of the header
        // — no matter its own z-index — is stacked *within* that context,
        // capped at the header's own z-1 level relative to sibling cards
        // (the calendar strip, day-detail, etc.), so it rendered visually
        // behind them regardless of z-30 here. `createPortal` to
        // `document.body` escapes the header's stacking context entirely,
        // the same way it would need to if this toast were a modal — a
        // fixed-position element nested inside ANY ancestor that creates a
        // stacking context (an explicit z-index + non-static position, a
        // transform, etc.) needs a portal to reliably stack above siblings
        // of that ancestor, not just a higher z-index of its own.
        createPortal(
          <div
            role="status"
            aria-live="polite"
            className="fixed inset-x-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-30 rounded-[var(--radius-panel)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3 text-xs shadow-[0_1px_2px_rgba(0,0,0,0.08),0_18px_36px_-18px_rgba(0,0,0,0.45)]"
          >
            {status === "uploading" ? (
              <p className="text-[var(--color-ink-soft)]">Transcribing…</p>
            ) : status === "commanding" ? (
              <p className="text-[var(--color-ink-soft)]">Working on it…</p>
            ) : errorMessage ? (
              <p className="text-[var(--color-ink-soft)]">{errorMessage}</p>
            ) : actionNote ? (
              <p className="text-[var(--color-ink)]">{actionNote}</p>
            ) : commandResult?.outcome === "needs_confirmation" && commandResult.proposedAction ? (
              <p className="text-[var(--color-ink)]">{commandResult.proposedAction.summary}</p>
            ) : commandResult?.outcome === "executed" ? (
              <p className="text-[var(--color-ink)]">{commandResult.summary || "Done."}</p>
            ) : commandResult?.outcome === "no_action" ? (
              <p className="text-[var(--color-ink-soft)]">{commandResult.summary || "Nothing to do with that."}</p>
            ) : commandResult?.outcome === "error" ? (
              <p className="text-[var(--color-ink-soft)]">{commandResult.error || "Couldn't run that voice command."}</p>
            ) : transcript ? (
              <p className="text-[var(--color-ink)]">Heard: “{transcript}”</p>
            ) : (
              <p className="text-[var(--color-ink-soft)]">Didn't catch that — try again.</p>
            )}

            {resultVisible && commandResult?.outcome === "needs_confirmation" && commandResult.proposedAction && (
              <div className="mt-1.5 flex gap-3">
                <button
                  type="button"
                  onClick={confirmAction}
                  disabled={actionBusy}
                  className="cursor-pointer text-[10px] font-bold text-[var(--color-accent)] disabled:opacity-50"
                >
                  Confirm
                </button>
                <button
                  type="button"
                  onClick={cancelAction}
                  disabled={actionBusy}
                  className="cursor-pointer text-[10px] font-bold text-[var(--color-ink-faint)] disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            )}

            {resultVisible && !(commandResult?.outcome === "needs_confirmation" && commandResult.proposedAction) && (
              <div className="mt-1.5 flex gap-3">
                {commandResult?.outcome === "executed" && commandResult.batchId && (
                  <button
                    type="button"
                    onClick={undoBatch}
                    disabled={actionBusy}
                    className="cursor-pointer text-[10px] font-bold text-[var(--color-accent)] disabled:opacity-50"
                  >
                    Undo
                  </button>
                )}
                <button
                  type="button"
                  onClick={reset}
                  className="cursor-pointer text-[10px] font-bold text-[var(--color-ink-faint)]"
                >
                  Dismiss
                </button>
              </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
