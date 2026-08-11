import { cx } from "../lib/cx";

interface NotificationPromptProps {
  open: boolean;
  onDismiss: () => void;
}

function BellIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true">
      <path
        d="M10 2.5c-2.2 0-4 1.8-4 4v2.4c0 .5-.2 1-.5 1.4L4.3 12a1 1 0 0 0 .8 1.6h9.8a1 1 0 0 0 .8-1.6l-1.2-1.7c-.3-.4-.5-.9-.5-1.4V6.5c0-2.2-1.8-4-4-4Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M8.2 15.3a1.9 1.9 0 0 0 3.6 0" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

/**
 * M2 UI-only mock of ARCHITECTURE.md §8a's one-time in-app nudge — the
 * *pre*-permission explainer, not the native OS prompt. Per the coordinator's
 * instruction this pass, it does not call `Notification.requestPermission()`,
 * register any Web Push subscription, or touch a service worker; both
 * buttons just dismiss it. "Enable notifications" wiring to the real
 * browser permission dialog + VAPID subscription is real infra for after
 * this batch is approved (M5, gated on M4's installed-PWA service worker
 * per the doc).
 */
export function NotificationPrompt({ open, onDismiss }: NotificationPromptProps) {
  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label="Enable notifications"
      className={cx(
        // Deliberately below the day-detail sheet (z-40) and add-event
        // overlay (z-50): opening either should visually supersede this
        // lightweight nudge, not fight it for taps, on iPhone width.
        "fixed inset-x-4 bottom-4 z-30 transition-all duration-300 ease-out md:right-6 md:bottom-6 md:left-auto md:w-80",
        open ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-3 opacity-0",
      )}
    >
      <div className="flex flex-col gap-3 rounded-[var(--radius-panel)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4 shadow-[0_1px_2px_rgba(0,0,0,0.08),0_18px_36px_-18px_rgba(0,0,0,0.45)]">
        <div className="flex items-start gap-2.5">
          <span className="grid h-8 w-8 flex-none place-items-center rounded-full bg-[var(--color-accent)] text-[var(--color-accent-ink)]">
            <BellIcon />
          </span>
          <div>
            <p className="text-sm font-bold" style={{ fontFamily: "var(--font-display)" }}>
              Stay in the loop
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-[var(--color-ink-soft)]">
              Get a nudge 30 minutes before anything on the calendar — anyone's, not just yours.
            </p>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onDismiss}
            className="cursor-pointer rounded-full border border-[var(--color-line)] px-3.5 py-1.5 text-xs font-bold text-[var(--color-ink-soft)]"
          >
            Not now
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="cursor-pointer rounded-full bg-[var(--color-accent)] px-3.5 py-1.5 text-xs font-bold text-[var(--color-accent-ink)]"
          >
            Enable notifications
          </button>
        </div>
      </div>
    </div>
  );
}
