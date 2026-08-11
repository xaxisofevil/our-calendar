import { useCallback, useEffect, useState } from "react";

// Frontend half of the device-session passcode gate (ARCHITECTURE.md §5/§12,
// M5/M6). The backend cookie is what makes a *returning* visit skip this
// entirely ("tap the bookmarked icon and it just works forever after") — this
// module is only about the in-tab state machine for the current page load:
// checking once on mount, then reacting if any later request comes back 401
// (session revoked/expired mid-visit).

export type AuthStatus = "checking" | "authenticated" | "unauthenticated";

type Listener = () => void;
const unauthorizedListeners = new Set<Listener>();

/** Called by lib/api.ts's request() whenever any /api/* call comes back
 * 401 — the one place "something invalidated our session" gets detected,
 * regardless of which query/mutation triggered it. */
export function notifyUnauthorized(): void {
  for (const listener of unauthorizedListeners) listener();
}

function subscribeUnauthorized(listener: Listener): () => void {
  unauthorizedListeners.add(listener);
  return () => unauthorizedListeners.delete(listener);
}

/**
 * Runs one lightweight auth-check (`GET /api/auth/session`) on mount to
 * decide whether to show the full-screen passcode entry or the real app,
 * and flips back to "unauthenticated" the moment any other request 401s.
 * `markAuthenticated` is called by the passcode screen itself on a
 * successful login — no need to re-hit the network, the login response
 * already told us.
 */
export function useAuthGate(): { status: AuthStatus; markAuthenticated: () => void } {
  const [status, setStatus] = useState<AuthStatus>("checking");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/session", { credentials: "same-origin" })
      .then((res) => {
        if (cancelled) return;
        // Only an explicit 401 means "not logged in." Anything else (a
        // 5xx, or the request never completing at all — see .catch below)
        // isn't really a statement about auth, so don't gate on it; let
        // the app render and surface its own "couldn't reach the server"
        // state (ARCHITECTURE.md §4's PWA design already owns that story —
        // e.g. App.tsx's `eventsQuery.isError` banner) instead of showing
        // an actively misleading passcode screen to someone who may well
        // already be logged in.
        setStatus(res.status === 401 ? "unauthenticated" : "authenticated");
      })
      .catch(() => {
        // Network-level failure (server unreachable, request aborted) —
        // same reasoning as the non-401 branch above.
        if (!cancelled) setStatus("authenticated");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => subscribeUnauthorized(() => setStatus("unauthenticated")), []);

  const markAuthenticated = useCallback(() => setStatus("authenticated"), []);

  return { status, markAuthenticated };
}
