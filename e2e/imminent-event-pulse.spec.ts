import { test, expect } from "@playwright/test";
import { fillEventForm, openAddEventSheet, saveEventForm, selectDay } from "./helpers";

// ARCHITECTURE.md §8b (Imminent-Event Highlighting): an event is "imminent"
// if `now <= event.startAt < now + NOTIFICATION_LEAD_MINUTES` (30, mirrored
// from §8a in frontend/src/lib/imminent.ts, since push notifications
// themselves are still M5/unbuilt — see the roadmap, §14). Only the
// month-grid dot for that day and the event's own day-detail row (when that
// day is selected) ever get the `imminent-dot`/`imminent-row` pulse class.
//
// This uses Playwright's virtual clock (page.clock) instead of real
// wall-clock waits, so the "clears once start time passes" behavior is
// verified deterministically and fast rather than sleeping 10+ real
// minutes.
function hhmm(date: Date): string {
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

function plusMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

test.describe("Imminent-event pulse (ARCHITECTURE.md §8b)", () => {
  test("pulses only the imminent event's dot/row, not events already started or too far out, and clears once start passes", async ({
    page,
  }) => {
    // Freeze/virtualize time at "now" (rounded to a clean minute so the
    // later HH:MM math is exact) before the page ever loads, so the app's
    // own `new Date()` calls (including the imminent-pulse timer in
    // lib/imminent.ts) run against this controlled clock throughout.
    const referenceTime = new Date();
    referenceTime.setSeconds(0, 0);
    await page.clock.install({ time: referenceTime });

    await page.goto("/");
    await selectDay(page, referenceTime);

    // Three events on today, one per (distinct) person so each gets its
    // own month-grid dot, spanning the three cases §8b's `isImminent`
    // needs to distinguish:
    const alreadyStarted = { title: "Already started", person: "Eric" as const, start: plusMinutes(referenceTime, -10) };
    const imminent = { title: "Imminent soon", person: "Lindsay" as const, start: plusMinutes(referenceTime, 10) };
    const farOut = { title: "Far out", person: "Gavin" as const, start: plusMinutes(referenceTime, 180) };

    for (const ev of [alreadyStarted, imminent, farOut]) {
      await openAddEventSheet(page);
      await fillEventForm(page, {
        title: ev.title,
        person: ev.person,
        startTime: hhmm(ev.start),
        endTime: hhmm(plusMinutes(ev.start, 30)),
      });
      await saveEventForm(page);
    }

    const panel = page.locator('section[aria-label="Selected day"]');
    const imminentRow = panel.locator("li", { hasText: imminent.title });
    const startedRow = panel.locator("li", { hasText: alreadyStarted.title });
    const farOutRow = panel.locator("li", { hasText: farOut.title });

    // Row-level: only the one starting in 10 minutes pulses.
    await expect(imminentRow).toHaveClass(/imminent-row/);
    await expect(startedRow).not.toHaveClass(/imminent-row/);
    await expect(farOutRow).not.toHaveClass(/imminent-row/);

    // Dot-level: 3 distinct people = 3 dots on today's cell, exactly one
    // (Lindsay's) pulsing.
    const cell = page.locator('section[aria-label="Month"] [aria-current="date"]');
    await expect(cell.locator("span.h-1.w-1")).toHaveCount(3);
    await expect(cell.locator("span.imminent-dot")).toHaveCount(1);

    // Jump the virtual clock 11 minutes forward — past the "imminent" event's
    // start time. §8b: "the class is removed automatically once the event's
    // start time passes." fastForward fires any due timers (including the
    // 30s recheck interval in lib/imminent.ts) once while jumping, so this
    // doesn't require waiting out 11 real minutes or ticking 22 times.
    await page.clock.fastForward("11:00");

    await expect(imminentRow).not.toHaveClass(/imminent-row/);
    await expect(cell.locator("span.imminent-dot")).toHaveCount(0);
    // The other two rows/dots are unaffected by the clock jump.
    await expect(startedRow).not.toHaveClass(/imminent-row/);
    await expect(farOutRow).not.toHaveClass(/imminent-row/);
  });

  test("prefers-reduced-motion swaps the pulse for a static highlight (no animation) on the imminent row", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });

    const referenceTime = new Date();
    referenceTime.setSeconds(0, 0);
    await page.clock.install({ time: referenceTime });
    await page.goto("/");
    await selectDay(page, referenceTime);

    await openAddEventSheet(page);
    await fillEventForm(page, {
      title: "Reduced motion imminent",
      startTime: hhmm(plusMinutes(referenceTime, 5)),
      endTime: hhmm(plusMinutes(referenceTime, 35)),
    });
    await saveEventForm(page);

    const row = page.locator('section[aria-label="Selected day"] li', { hasText: "Reduced motion imminent" });
    await expect(row).toHaveClass(/imminent-row/);
    // ARCHITECTURE.md §8b accessibility: "swapping the animation for a
    // static tinted highlight instead of an ongoing pulse" — the class is
    // still applied (same information), but index.css's reduced-motion
    // block forces `animation: none`.
    await expect(row).toHaveCSS("animation-name", "none");
  });
});
