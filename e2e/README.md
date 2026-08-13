# Our Calendar — E2E suite (QA validator)

Playwright coverage for M0 (skeleton), M1 (month calendar, day-detail,
add-event/add-todo, per-person color coding, Paper & Ink skin, responsive
tablet/iPhone layouts), M2 (SSE live-sync for events/todos, recurring
events wired to real RRULE persistence + read-time expansion, todo due
dates + overdue sort-to-top wired to a real `due_at` column, the three
validation/error-surfacing bug fixes, delete-affordance and event-editing),
M4 (`pwa.spec.ts` — manifest.json served with the right installability
fields/icons, service worker registration, app-shell-only caching with no
`/api/` entries ever landing in `CacheStorage`, and the "can't reach
server" state when `/api/*` is unreachable — see ARCHITECTURE.md §4's "PWA
implementation" subsection for the full design, including the M5 switch
from `generateSW` to `injectManifest`), and M5 (`push-notifications.spec.ts`
— `POST`/`DELETE /api/push/subscribe` persistence/validation/upsert/
idempotent-delete, the in-process reminder-scan interval finding a
qualifying occurrence and recording it in `sent_reminders` exactly once
across multiple ticks, an out-of-window occurrence correctly never
recorded, and the real "Enable notifications" UI flow with the browser's
`Notification`/`PushManager` APIs mocked — see ARCHITECTURE.md §8a's
"Implementation (M5 — done)" subsection), and M7 (`voice.spec.ts` —
`POST /api/voice/transcribe`'s success/silent-clip/empty-body/Deepgram-error/
unconfigured-key paths, and the push-to-talk UI flow with the browser's
`MediaRecorder`/`getUserMedia` mocked — see ARCHITECTURE.md §9's
"Implementation (M7 — done)" subsection). The hide-completed-todos toggle
is still UI-only per ARCHITECTURE.md's M2 scope (deliberately per-device
localStorage, no backend persistence planned/needed).

`push-notifications.spec.ts` runs against a throwaway VAPID keypair and a
sped-up `REMINDER_SCAN_INTERVAL_MS`, configured only for the isolated e2e
backend (see `e2e/helpers.ts`) — never the real household VAPID keys, which
live in a real, gitignored `backend/.env` this suite never reads. Since
`push_subscriptions`/`sent_reminders` have no REST read endpoint (§12
deliberately doesn't expose one), assertions on their contents read the
isolated e2e SQLite file directly (`e2e/db.ts`, read-only) rather than the
real dev/prod database.

`voice.spec.ts` runs against a fake `DEEPGRAM_API_KEY` pointed at a local
mock server (`e2e/mock-deepgram-server.mjs`) instead of the real Deepgram
API — there is no real key available yet (see ARCHITECTURE.md §9). Its
"key isn't configured" test hits a second, minimal backend instance
(`:4403`) that deliberately has no key set at all, rather than toggling the
primary backend's config mid-suite — see `playwright.config.ts`'s comments
on both extra processes.

## Running

```
npm install
npx playwright install chromium   # first time only
npm run test:e2e
```

This starts an isolated backend on `:4001`, an isolated Vite dev server on
`:4173`, a mock Deepgram server on `:4402`, and a second minimal backend
with no Deepgram key on `:4403` (see `playwright.config.ts`) — **never** the
normal `:3001`/`:5173` dev instance that may hold real household data. The
primary backend wipes its own `backend/data/` directory on boot for every
`test:e2e` run (see `backend/scripts/reset-and-dev.mjs`) and reseeds from
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
