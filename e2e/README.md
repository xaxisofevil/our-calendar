# Our Calendar — E2E suite (QA validator)

Independent Playwright coverage for M0 (skeleton) + M1 (month calendar,
day-detail, add-event/add-todo, per-person color coding, Paper & Ink skin,
responsive tablet/iPhone layouts). Explicitly **excludes** the M2-in-progress
partial code visible in this tree (recurring events / "Repeats" picker,
hide-completed-todos toggle, todo due dates, the delete-button visual fix,
notification opt-in) — that work is mid-implementation elsewhere and not yet
stable; see the top-level QA report for details, not this file.

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

Todos are dateless/global, so `add-todo.spec.ts` isolates itself with
`Date.now()`-suffixed unique text instead of day offsets.

## Known-failing tests (documenting real bugs, not test bugs)

A few tests assert the *intended* behavior from the task spec / plain good
UX rather than current (buggy) behavior, and are expected to fail until the
underlying app bug is fixed — see the QA report for full detail:

- `add-event.spec.ts` → blank title is silently saved as "Untitled event"
  instead of being rejected.
- `add-event.spec.ts` → an overlong title that the backend correctly
  rejects (400) fails silently in the UI (sheet closes, no error shown, no
  event created).
- `add-todo.spec.ts` → same silent-failure pattern for overlong todo text.

Additionally: **the whole app currently fails to render at all** (blank
white screen, uncaught `TypeError` reading `.get` of `undefined`) because
`App.tsx` doesn't pass the `dueDates` prop that `TodoList.tsx` requires —
see the QA report's top finding. Until that one-line wiring bug is fixed,
every test in this suite fails as a downstream consequence, not because the
suite itself is wrong. Re-run `npm run test:e2e` after that fix lands to get
the real M1 signal.
