import { useEffect, useState } from "react";

/** Tracks a CSS media query's current match state in JS — used where a
 * component needs to actually branch on breakpoint (not just show/hide via
 * CSS), e.g. App.tsx mounting exactly one DayDetailPanel instance (the
 * mobile full-screen sheet vs. the tablet card) instead of both at once. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query).matches : false,
  );

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    function handleChange(e: MediaQueryListEvent) {
      setMatches(e.matches);
    }
    setMatches(mql.matches);
    mql.addEventListener("change", handleChange);
    return () => mql.removeEventListener("change", handleChange);
  }, [query]);

  return matches;
}
