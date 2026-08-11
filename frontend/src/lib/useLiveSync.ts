import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

/**
 * Opens the SSE channel documented in ARCHITECTURE.md §3/§12
 * (`GET /api/stream`) and invalidates the matching TanStack Query cache
 * whenever another client's mutation broadcasts a "...:changed" event —
 * the live-sync mechanism that fixes "I had to manually refresh to see
 * what she added." One EventSource for the app's lifetime; the browser's
 * native auto-reconnect handles drops, so there's no custom retry/backoff
 * logic to write (same reasoning as ARCHITECTURE.md §3's SSE-over-WebSockets
 * choice).
 *
 * `enabled` (default true) lets App.tsx hold the connection off until the
 * passcode gate (lib/auth.ts) confirms a session — GET /api/stream requires
 * auth like every other /api/* route now (§5/§12), and EventSource has no
 * clean way to read a 401 status before it just retries forever, so this
 * avoids that noise while the passcode screen is up.
 */
export function useLiveSync(enabled = true): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return;
    const source = new EventSource("/api/stream");
    source.addEventListener("events:changed", () => {
      queryClient.invalidateQueries({ queryKey: ["events"] });
    });
    source.addEventListener("todos:changed", () => {
      queryClient.invalidateQueries({ queryKey: ["todos"] });
    });
    return () => source.close();
  }, [queryClient, enabled]);
}
