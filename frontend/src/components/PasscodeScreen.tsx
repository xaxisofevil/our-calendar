import { useState, type FormEvent } from "react";
import * as api from "../lib/api";

interface PasscodeScreenProps {
  onSuccess: () => void;
}

/**
 * Full-screen passcode gate (ARCHITECTURE.md §5/§12, M5/M6) — shown whenever
 * lib/auth.ts's useAuthGate reports "unauthenticated" (no session cookie yet,
 * or a request came back 401 mid-visit). Nothing else renders alongside it;
 * a correct passcode sets the long-lived session cookie server-side and the
 * caller (App.tsx) swaps this out for the real app — that cookie is what
 * makes every *later* visit skip this screen entirely (§5's "tap the
 * bookmarked icon and it just works forever after"), so there's
 * deliberately no "remember me" control here — nothing to configure.
 *
 * Styled straight from the Paper & Ink tokens (styles/tokens.css), reusing
 * the same input/button/error treatment as AddEventSheet.tsx so this reads
 * as part of the same app, not a separate login page.
 */
export function PasscodeScreen({ onSuccess }: PasscodeScreenProps) {
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!passcode || submitting) return;
    setSubmitting(true);
    try {
      await api.login(passcode);
      onSuccess();
    } catch {
      // §5: no information leakage about *why* a passcode was rejected —
      // one generic message regardless of what the backend actually said.
      setError("That passcode didn't work. Try again.");
      setPasscode("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="skin-grain fixed inset-0 z-50 flex min-h-full items-center justify-center bg-[var(--color-bg)] p-6 text-[var(--color-ink)]">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-[340px] rounded-[var(--radius-panel)] border border-[var(--color-line)] bg-[var(--color-surface)] p-6 shadow-[0_1px_2px_rgba(0,0,0,0.08),0_18px_36px_-18px_rgba(0,0,0,0.45)]"
      >
        <p className="mb-1 text-lg font-bold" style={{ fontFamily: "var(--font-display)" }}>
          Our Calendar
        </p>
        <p className="mb-4 text-xs text-[var(--color-ink-soft)]">Enter the household passcode to continue.</p>

        <label className="mb-1 flex flex-col gap-1">
          <span className="text-[0.66rem] font-bold tracking-wide text-[var(--color-ink-soft)] uppercase">Passcode</span>
          <input
            autoFocus
            type="password"
            autoComplete="off"
            value={passcode}
            onChange={(e) => {
              setPasscode(e.target.value);
              if (error) setError(null);
            }}
            aria-invalid={error != null}
            aria-label="Passcode"
            className="w-full rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-bg)] px-2.5 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
          />
        </label>
        {error && <p className="mb-1 text-[0.66rem] font-semibold text-[var(--color-accent)]">{error}</p>}

        <button
          type="submit"
          disabled={submitting || !passcode}
          className="mt-4 w-full cursor-pointer rounded-full bg-[var(--color-accent)] px-4.5 py-2 text-sm font-bold text-[var(--color-accent-ink)] disabled:cursor-default disabled:opacity-50"
        >
          {submitting ? "Checking…" : "Unlock"}
        </button>
      </form>
    </div>
  );
}
