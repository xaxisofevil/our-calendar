import { type PointerEvent as ReactPointerEvent } from "react";
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
  done: "Hold to talk again",
  error: "Hold to talk",
};

/**
 * ARCHITECTURE.md §9 (M7) — the push-to-talk mic button. Self-contained
 * (unlike NotificationPrompt.tsx, whose open/dismiss/enable state is lifted
 * to App.tsx): there's no cross-component state for a transcript to feed
 * yet — §10's command layer, which would eventually act on it, is
 * explicitly out of scope for this pass — so the whole capture/upload/
 * display state machine lives in useVoiceCapture and this component
 * together, and App.tsx just mounts `<VoiceButton />` in the header the
 * same way it mounts the bell-preview button next to it.
 *
 * Shows a plain, honest `Heard: "…"` line once transcription succeeds — no
 * simulated command execution. An empty transcript (Deepgram genuinely
 * heard nothing) and every real-world failure mode a non-technical user can
 * hit (mic permission denied, no MediaRecorder/getUserMedia support on this
 * browser, the upload itself failing) each get their own clear, plain-
 * language message from useVoiceCapture — never a raw error object or a
 * silent no-op.
 */
export function VoiceButton() {
  const { status, transcript, errorMessage, start, stop, reset, supported } = useVoiceCapture();

  const recording = status === "recording";
  const uploading = status === "uploading";
  const resultVisible = status === "done" || status === "error";

  function handlePressStart(e: ReactPointerEvent<HTMLButtonElement>) {
    if (e.button != null && e.button !== 0) return; // primary button/touch/pen only
    if (recording || uploading) return;
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
            : uploading
              ? "border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-ink-faint)]"
              : "border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-ink-soft)]",
        )}
      >
        <MicIcon />
      </button>

      {uploading && (
        <div
          role="status"
          aria-live="polite"
          className="absolute right-0 top-full z-20 mt-2 w-44 rounded-[var(--radius-panel)] border border-[var(--color-line)] bg-[var(--color-surface)] p-2.5 text-xs text-[var(--color-ink-soft)] shadow-[0_1px_2px_rgba(0,0,0,0.08),0_18px_36px_-18px_rgba(0,0,0,0.45)]"
        >
          Transcribing…
        </div>
      )}

      {resultVisible && (
        <div
          role="status"
          aria-live="polite"
          className="absolute right-0 top-full z-20 mt-2 w-64 rounded-[var(--radius-panel)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3 text-xs shadow-[0_1px_2px_rgba(0,0,0,0.08),0_18px_36px_-18px_rgba(0,0,0,0.45)]"
        >
          {errorMessage ? (
            <p className="text-[var(--color-ink-soft)]">{errorMessage}</p>
          ) : transcript ? (
            <p className="text-[var(--color-ink)]">Heard: “{transcript}”</p>
          ) : (
            <p className="text-[var(--color-ink-soft)]">Didn't catch that — try again.</p>
          )}
          <button
            type="button"
            onClick={reset}
            className="mt-1.5 cursor-pointer text-[10px] font-bold text-[var(--color-ink-faint)]"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
