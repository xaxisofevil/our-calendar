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
 */
export function useLiveSync(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    const source = new EventSource("/api/stream");
    source.addEventListener("events:changed", () => {
      queryClient.invalidateQueries({ queryKey: ["events"] });
    });
    source.addEventListener("todos:changed", () => {
      queryClient.invalidateQueries({ queryKey: ["todos"] });
    });
    return () => source.close();
  }, [queryClient]);
}
