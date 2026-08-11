# Our Calendar — E2E suite (QA validator)

Playwright coverage for M0 (skeleton), M1 (month calendar, day-detail,
add-event/add-todo, per-person color coding, Paper & Ink skin, responsive
tablet/iPhone layouts), and M2 (SSE live-sync for events/todos, recurring
events wired to real RRULE persistence + read-time expansion, todo due
dates + overdue sort-to-top wired to a real `due_at` column, the three
validation/error-surfacing bug fixes, delete-affordance and event-editing).
The hide-completed-todos toggle and notification opt-in are still UI-only
per ARCHITECTURE.md's M2 scope (no backend persistence for either is
planned/needed — hide-completed is deliberately per-device localStorage,
and the notification prompt is a pre-permission explainer only, real Web
Push wiring is M5).

## Running

```
npm install
npx playwright install chromium   # first time only
npm run test:e2e
```

This starts an isolated backend on `:4001` and an isolated Vite dev server on
`:4173` (see `playwright.config.ts`), **never** the normal `:3001`/`:5173`
dev instance that may hold real household data. The backend wipes its own
`backend/data/` directory on boot for every `test:e2e` run (see
`backend/scripts/reset-and-dev.mjs`) and reseeds from
`backend/src/db/seed.ts`, so runs are deterministic and don't accumulate
cruft across repeated invocations.

## Day-offset convention

Events are day-scoped and the backend has no per-test reset, so spec files
that create events pick disjoint `addDaysFromToday(n)` offsets to avoid
cross-test/cross-file interference within a single `test:e2e` run (tests run
with `workers: 1`, serially, sharing one backend/DB):

| Offset | Used by | Notes |
|---|---|---|
| 0 | `responsive.spec.ts` | Never mutated — only panel-chrome/visibility is checked there. |
| 1 | `add-event.spec.ts` | Basic add-event + default-person tests. |
| 2 | `add-event.spec.ts` | All-day toggle / cancel / time-correction tests. |
| 3 | seeded | "Dentist" (Eric), read-only checks in `day-detail.spec.ts` / `person-colors.spec.ts`. |
| 4 | `add-event.spec.ts` | Blank-title adversarial case. |
| 5 | `add-event.spec.ts` | Overlong-title adversarial case. |
| 6 | `delete-event.spec.ts` | |
| 7 | `person-colors.spec.ts` | Multi-person dedup dots. |
| 9 | `day-detail.spec.ts` | Deliberately never written to — empty-state checks. |
| 10 | `day-detail.spec.ts` | Day-to-day panel update check. |
| 11 | seeded | "Soccer practice" (Gavin), read-only. |
| 12 | `person-colors.spec.ts` | API-created unassigned-person event. |
| 13 | `add-event.spec.ts` | Double-submit observation. |
| 14 | `add-event.spec.ts` | XSS/special-characters title. |
| 15 | `recurring-events.spec.ts` | Weekly recurrence expansion correctness (checked via the API over a wide range, not grid navigation — see the spec file's header comment). |
| 16 | `recurring-events.spec.ts` | Editing a recurring event (whole-series rename). |
| 17 | `recurring-events.spec.ts` | Deleting a recurring event (whole-series delete). |
| 18 | `recurring-events.spec.ts` | Repeats field pre-fill on edit. |
| 19 | `recurring-events.spec.ts` | Non-recurring regression check (`recurrenceRule: null`, exactly one occurrence). |
| 20 | `live-sync.spec.ts` | SSE: create, two-client. |
| 21 | `live-sync.spec.ts` | SSE: delete, two-client. |

Todos are dateless/global, so `add-todo.spec.ts` and `todo-due-dates.spec.ts`
isolate themselves with `Date.now()`-suffixed unique text instead of day
offsets. `live-sync.spec.ts`'s todo test does the same.

## Formerly-known-failing tests — now fixed

`add-event.spec.ts` and `add-todo.spec.ts` each still contain the same
adversarial tests the independent QA pass originally wrote against the
*intended* behavior (reject a blank title client-side; surface a visible
error when the backend correctly rejects an overlong title/text). Those
tests used to be documented here as expected-failing, encoding real bugs.
M2 fixed the underlying app code (`AddEventSheet.tsx`'s `handleSave`,
`TodoList.tsx`, `App.tsx`'s mutation wiring, `lib/queries.ts`'s `onError`,
new `lib/errors.ts`) rather than the tests, so they now pass like everything
else in the suite — nothing in this suite is expected to fail on a clean
run.
