import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { cx } from "../lib/cx";
import { useAutoCollapse } from "../lib/useAutoCollapse";

// Direct request: a tablet-only way to glance at the household's existing
// Home Assistant Lovelace dashboard from the fridge tablet, without leaving
// the calendar app or maintaining a second, duplicate UI for it. HA itself
// remains explicitly out-of-scope infrastructure this app doesn't otherwise
// integrate with (ARCHITECTURE.md §2/§6) — this is a narrow, deliberate
// exception: an iframe of HA's own already-built dashboard, not a real
// integration (no API calls to HA, no shared auth beyond HA's own
// already-active browser session on this tablet).
//
// Embedded, not a plain navigation, specifically because the auto-return
// behavior below requires it: this app's own JS has to keep running while
// the dashboard is showing, which only happens if HA is shown *inside* this
// page (an iframe) rather than the browser fully navigating away to HA's
// origin — a real navigation would tear down this component (and its idle
// timer) the moment it started.
//
// Real, disclosed limitation of that choice: cross-origin iframe content is
// invisible to this page's own JS by browser design (the same isolation
// that keeps a malicious embedded page from reading this app's session) —
// so a touch/interaction genuinely *inside* the HA dashboard (e.g. dragging
// a thermostat slider) cannot reset the idle timer below; only interaction
// with this modal's own chrome (the back bar, its background) can. Reusing
// useAutoCollapse's existing 3-minute kiosk-safety-net window (same one
// ExpandedPanelModal already uses) makes an accidental mid-interaction
// return unlikely without pretending this limitation doesn't exist.
const HA_DASHBOARD_URL = "https://ericb.duckdns.org/dashboard-uptime/0";

function GaugeIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} aria-hidden="true">
      <path
        d="M3 13a7 7 0 1 1 14 0"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path d="M10 13 13 8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="10" cy="13" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function BackIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-3 w-3" aria-hidden="true">
      <path
        d="M12 4.5 6.5 10l5.5 5.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function HaDashboardButton() {
  const [open, setOpen] = useState(false);
  // True for one frame after `open` flips true — lets the modal mount at
  // its entrance-transition starting state, then immediately transition to
  // its resting state, rather than the CSS transition having nothing to
  // animate *from* because both states landed in the same render.
  const [visible, setVisible] = useState(false);
  const bump = useAutoCollapse(open, () => setOpen(false));

  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, [open]);

  function close() {
    setVisible(false);
    // Let the exit transition play before actually unmounting the iframe —
    // matches the duration below.
    setTimeout(() => setOpen(false), 200);
  }

  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  return (
    <>
      {/* Tablet-only trigger (md+) — mounted in App.tsx's header, next to the
          bell-preview icon. Not hidden on purpose: viewing the household's
          own smart-home dashboard isn't sensitive to anyone in the house,
          and a hidden control on a shared kiosk display mostly just creates
          confusion, not privacy. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open the Home Assistant dashboard"
        title="Home Assistant dashboard"
        className="hidden h-7 w-7 flex-none cursor-pointer place-items-center rounded-full border border-[var(--color-line)] text-[var(--color-ink-soft)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] md:grid"
      >
        <GaugeIcon />
      </button>

      {open &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Home Assistant dashboard"
            // z-[60] — one tier above every other overlay in this app
            // (AddEventSheet/ExpandedPanelModal/PasscodeScreen all top out
            // at z-50) since this is a full takeover view; nothing else
            // should be able to show through it. Fade + slight scale on
            // entrance/exit (200ms, matches close()'s own timeout above) —
            // an abrupt cut to a whole different site felt jarring in
            // practice; this softens the transition without slowing it down.
            className={cx(
              "fixed inset-0 z-[60] flex flex-col bg-[var(--color-bg)] transition-all duration-200 ease-out",
              visible ? "opacity-100" : "opacity-0",
            )}
            onPointerDown={bump}
          >
            <div
              className={cx(
                "flex flex-none items-center justify-between gap-3 border-b border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.06),0_12px_24px_-16px_rgba(0,0,0,0.35)] transition-transform duration-200 ease-out",
                visible ? "translate-y-0" : "-translate-y-2",
              )}
            >
              <div className="flex items-center gap-2.5">
                <span className="grid h-8 w-8 flex-none place-items-center rounded-full bg-[var(--color-accent)] text-[var(--color-accent-ink)]">
                  <GaugeIcon className="h-4 w-4" />
                </span>
                <p className="text-sm font-bold" style={{ fontFamily: "var(--font-display)" }}>
                  Home Assistant
                </p>
              </div>
              <button
                type="button"
                onClick={close}
                className="flex cursor-pointer items-center gap-1.5 rounded-full bg-[var(--color-accent)] px-4 py-2 text-xs font-bold text-[var(--color-accent-ink)] shadow-[0_1px_2px_rgba(0,0,0,0.12)] transition-transform active:scale-95"
              >
                <BackIcon />
                Back to Calendar
              </button>
            </div>
            {/* No `sandbox` attribute, deliberately: this is trusted,
                known, single-household infrastructure (not arbitrary
                third-party content), and HA needs its own scripts + its
                already-active session cookie to render at all — a sandbox
                restrictive enough to matter here would just break it. */}
            <iframe
              src={HA_DASHBOARD_URL}
              title="Home Assistant dashboard"
              className="min-h-0 flex-1 border-0"
            />
          </div>,
          document.body,
        )}
    </>
  );
}
