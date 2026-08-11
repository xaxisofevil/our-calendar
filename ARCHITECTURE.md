# Our Calendar — Family Dashboard Architecture

Status: Draft v1 for review
Owner: Eric
Scope: v1 (daily-usable MVP) through v3 (voice/LLM)

---

## 0. MVP Definition (confirmed)

The smallest thing your wife will actually use every day, with nothing else built:

- Custom month calendar view (fridge tablet + iPhone)
- Tap a day → see that day's events
- Google Calendar is the source of truth; app reads and writes to it
- Shared, dateless household to-do list, syncing instantly across devices
- Installable iPhone PWA — tap icon, use, leave
- Lightweight auth + remote access, no VPN, no second app

Deliberately **out of v1**: voice, LLM, push notifications, weather, meal planning, grocery lists. The schema and API are shaped so these bolt on later without a rewrite, but nothing in v1 depends on them.

Home Assistant is **not part of this application at all**. It happens to run in the same house, but there's no product reason for the dashboard to talk to it, so it's dropped from this architecture entirely rather than deferred to a later version. HA keeps its own existing DuckDNS exposure and port forward, completely untouched by anything below.

---

## 1. Three Architectures, Kept Separate

- **Product architecture** — what the app does, for whom, regardless of where it runs.
- **Development architecture** — the fastest loop for you to iterate solo on your PC.
- **Production architecture** — the always-on, remotely-reachable version your wife and the tablet use.

Dev and prod run the **same code**, same SQLite-backed Node process — the only difference is how it's started and how traffic reaches it. That's deliberate: no separate "prod stack" to maintain, no Docker-vs-bare-metal drift, nothing to keep in sync. This is the biggest simplification relative to a "proper" enterprise setup, and it's justified here because there's one server, one deployment target, and one developer.

---

## 2. Overall Architecture

```
                         ┌─────────────────────────────┐
                         │        Windows PC            │
                         │   (always-on app server)     │
                         │                               │
  Internet ── DuckDNS ──▶│  Caddy (TLS + reverse proxy)  │
     :8443                │        │                      │
                         │        ├─ static frontend     │
                         │        │  (built React PWA)   │
                         │        │                      │
                         │        └─▶ Node/Express API    │
                         │             │      │          │
                         │             │      └─▶ SQLite  │
                         │             │                  │
                         │             ├─▶ Google Calendar API
                         │             ├─▶ Deepgram API (v2)
                         │             └─▶ Ollama (local LLM, v2)
                         └───────────────────────────────┘

  Internet ── DuckDNS ──▶ Raspberry Pi :8123 (Home Assistant — unrelated,
     :8123                pre-existing, untouched by this project)

Clients: fridge Android tablet (kiosk browser) · your wife's iPhone (installed PWA) · your Android phone
All clients talk to ONE origin: https://ericb.duckdns.org:8443
```

Single monolith backend, single SQLite file, single frontend bundle served same-origin as the API. No microservices, no message queue, no separate auth server — none of that buys anything at this scale and each would just be more to keep running on a home PC.

---

## 3. Backend Architecture

**Stack: Node.js + TypeScript + Express + Drizzle ORM + better-sqlite3 (SQLite, WAL mode)**

Why this over the alternatives:

| Option | Verdict | Why |
|---|---|---|
| Node/Express + TS | **Chosen** | One language across front/back (shared types for events/todos = fewer bugs), huge familiarity for any coding agent working on this, trivial to run as a single process on Windows. |
| Python/FastAPI | Rejected | Nicer if the backend *were* the ML runtime, but it isn't — the LLM runs behind Ollama's own HTTP API, so the backend just makes HTTP calls to it. Python buys nothing here and costs you a second language/toolchain. |
| Go | Rejected | Great for this kind of small service, but no shared types with the frontend and no real upside given the scale. |
| Fastify (instead of Express) | Considered | Nicer schema validation story, but Express is more universally known/generated correctly by tooling, and we get equivalent validation from `zod` directly. Not worth the swap. |

**Database: SQLite, not Postgres.** Zero ops, the entire database is one file, backup = copy the file. Two to three concurrent clients doing light CRUD is nowhere near where SQLite struggles. WAL mode avoids the one gotcha (writer blocking readers). Postgres would mean a service to install, configure, update, and back up for no concurrency benefit you'll ever hit.

**ORM: Drizzle**, not Prisma — lighter, SQL-shaped, no code-gen daemon, plays well with better-sqlite3's synchronous API (simpler than async drivers for a single-file local DB).

**Real-time sync: Server-Sent Events (SSE), not WebSockets.** The only thing that needs to be "instant" is other devices finding out the to-do list or calendar changed. That's one-directional (server → client) push of a small "something changed, refetch" signal. SSE gives you that with a plain `EventSource` on the client (auto-reconnects natively, no heartbeat/reconnect logic to write) and a single open HTTP response on the server. WebSockets would add a protocol, a library, and reconnection handling for a bidirectional channel you don't need — mutations still just go over normal POST/PATCH requests. Client pattern: mutate → optimistic UI update locally → server broadcasts an SSE event → all *other* connected clients refetch via their query cache. No CRDTs, no merge logic, no offline write queue — Google Calendar and SQLite stay the single source of truth and every client just re-reads it.

**Static frontend serving:** Caddy serves the built frontend files directly from disk (not proxied through Node) and reverse-proxies `/api/*` and `/api/stream` to the Node process. Simpler and faster than routing static assets through Express.

---

## 4. Frontend Architecture

**Stack: React + TypeScript + Vite + Tailwind CSS + TanStack Query + vite-plugin-pwa**

| Option | Verdict | Why |
|---|---|---|
| React + Vite | **Chosen** | Small, tree-shaken bundle (Vite), huge ecosystem/tooling familiarity (matters since a coding agent will implement this), and it's easy to keep the bundle light by just not adding heavy UI libraries. |
| Svelte/SvelteKit | Considered | Genuinely lighter runtime, which matters for an old tablet — but the gap only matters if you load React carelessly (large component libraries, heavy state managers). Kept lean, React's overhead on a month-grid + list UI is a non-issue, and you trade a real performance edge for a smaller ecosystem and more agent-generation risk. Not worth it here. |
| Vanilla JS | Rejected | "Avoid unnecessary complexity" cuts the other way here — no framework means hand-rolling reactivity/routing, which is more code and more bugs for a UI with real interactive state (SSE-driven live updates, day-detail transitions). |

**Styling:** Tailwind — no runtime cost (compiles to static CSS), fast to build a clean custom UI without hand-writing a component library. No MUI/AntD/etc. — those are heavy and fight you on custom design anyway, and the requirement is explicitly a *custom* UI.

**Data layer:** TanStack Query for fetching/caching `events` and `todos`. It pairs naturally with the SSE pattern above: an SSE message just calls `queryClient.invalidateQueries(...)`, and Query handles refetch/cache/loading states. Removes a lot of otherwise hand-written state-sync boilerplate.

**One responsive codebase, not two apps.** Same React tree for tablet and iPhone; layout adapts via CSS breakpoints only:
- **Tablet (large landscape screen):** month grid + day-detail as a side panel, both visible at once.
- **iPhone (narrow):** month grid full-width; tapping a day pushes a full-screen day-detail sheet.

This directly satisfies "the exact same application should work beautifully on both" — it's not two builds, just responsive layout.

**Theming: CSS custom-property tokens, chosen via Settings → Appearance.** During design exploration we produced several genuinely different visual "skins" (color, texture, type treatment) over the identical layout/components — which is exactly how this gets built: every skin-specific value (colors, borders, shadows, numeral font) is a CSS custom property defined once per skin under a `[data-skin="..."]` selector on the root, and components style themselves only in terms of those tokens, never hardcoded values. A settings surface was always going to exist eventually anyway (Google account management, list management, etc.), so the skin picker lives there rather than as a one-off toggle. Two independent axes, deliberately not conflated:
- **Skin** (Paper & Ink / Bold Signal / etc.) — a **shared household setting**, stored server-side, synced to every device via the same SSE pattern as the to-do list. The point of the app is that the tablet reflects what she saw on her phone — that includes how it looks, not just its data.
- **Light/dark** — stays automatic per-device via `prefers-color-scheme`, since that's about each screen's ambient lighting (dim kitchen at night vs. daylight on a phone), not household identity.

Sequencing: the token system and all skins are wired up during M1 (styling cost is the same whether one skin is hardcoded or several are swappable — doing it as tokens from the start is free; retrofitting it later isn't). The actual Settings → Appearance *page* and server-synced persistence lands in M2, reusing the settings/SSE plumbing already being built there for the to-do list — no need to build that infrastructure twice.

**PWA:** `vite-plugin-pwa` (Workbox under the hood) generates the manifest + service worker. Service worker caches the **app shell only** (JS/CSS/icons) for instant loads and installability — deliberately *not* caching API data. Freshness matters more than offline capability for a family coordination tool, and an offline-write queue with conflict resolution is real complexity for a feature nobody asked for. If the WiFi's down, the app should show "can't reach server," not stale calendar data presented as current. This can be revisited later if offline becomes an actual pain point.

**Fridge tablet kiosk mode:** don't try to build kiosk behavior into the PWA. Use **Fully Kiosk Browser** (free tier is fine) pointed at the dashboard URL — fullscreen, no system chrome, keeps the screen on, auto-restarts on crash/boot. It's a proven tool built for exactly this "wall-mounted dashboard" use case; reinventing that in-app isn't worth it.

---

## 5. Authentication & Security Boundaries — challenging the brief a bit

Two *separate* concerns get conflated if you're not careful, and I want to split them explicitly:

1. **Who's allowed to authorize *Google Calendar data access*** (a one-time, per-Google-account thing)
2. **Who's allowed to *use the dashboard app* day-to-day** (needs to be frictionless — tap icon and go)

**Calendar authorization:** each Google account you want represented on the calendar (yours, and your wife's if she has her own) goes through Google's OAuth consent screen **once**, during setup, from any browser. The resulting refresh token is stored server-side (encrypted at rest) in a `google_accounts` table designed to hold **one or many** accounts from day one — so it doesn't matter today whether you use a single shared family calendar or two personal ones that get merged; connecting a second account later is just running the same one-time flow again, no schema change. I'm not blocking the design on which of those you currently use.

**App access (daily use):** this should **not** require Google sign-in every day, and it should **not** be one shared static password living forever with no revocation story either. The middle ground: a **long-lived device session** — visit the URL once, enter a shared setup passcode, get an HttpOnly `Secure` cookie valid for ~1 year. After that, the tablet and your wife's installed PWA are just permanently signed in — exactly the "tap and leave" experience required. This is a deliberate departure from HTTP Basic Auth at the reverse-proxy layer, which is the "simple" default I'd otherwise reach for — **iOS Safari's standalone (home-screen) PWA mode handles Basic Auth prompts unreliably**, so it actively fights the "installable iPhone PWA" requirement. An app-level cookie session avoids that entirely.

**Security boundaries:**
- Internet only ever reaches Caddy (TLS termination); the Node process isn't directly exposed.
- OAuth tokens and the session-passcode hash are encrypted/hashed at rest, never sent to the frontend.
- No CORS needed — frontend and API are same-origin behind Caddy.
- (v2) The LLM never executes code or touches the DB directly — see §9.
- Home Assistant is out of scope for this app entirely — no code path in this project talks to it, so it's not part of the dashboard's security boundary at all.

---

## 6. Networking & Deployment

**Dev:** `npm run dev` runs Vite (frontend, hot reload) and the Express server (tsx watch) locally on your PC, both pointed at a local SQLite file. A dev-mode Google OAuth client with a `localhost` redirect URI lets you exercise real Calendar API calls while developing. No Docker, no reverse proxy, no TLS — none of that helps you iterate faster, so it's not in the dev loop at all.

**Current state (confirmed):** you have one DuckDNS hostname, `ericb.duckdns.org`, with its dynamic-DNS updater running on the Raspberry Pi, and port `8123` forwarded on your router straight to the Pi for Home Assistant. That setup is unrelated to this project and nothing below touches it.

**Adding the dashboard:** DuckDNS just keeps one hostname pointed at your home's public IP — it doesn't care how many ports you forward to how many internal devices, so this is additive, not a replacement:

- Forward a **second external port** — e.g. `8443` — on the router to the **Windows PC** (not the Pi).
- Caddy runs on the PC, terminates TLS on that port (Let's Encrypt via DuckDNS's ACME DNS-01 plugin, using the same `ericb.duckdns.org` hostname — DuckDNS supports multiple certs/ports on one hostname fine), and reverse-proxies to the local Node process.
- End result: `https://ericb.duckdns.org:8443` → dashboard, `https://ericb.duckdns.org:8123` (or however HA's currently reached) → Home Assistant, completely independent of each other. One router change, zero risk to the existing HA config.

The URL being port-suffixed and inelegant doesn't matter in practice — nobody types it, it's a one-time bookmark/home-screen-icon.

The Node process itself runs under **PM2** (simpler than a native Windows Service for a Node app — `pm2 start`, auto-restart on crash, boot-time startup via `pm2-windows-startup` in a couple of commands).

---

## 7. Google Calendar Integration

Google Calendar stays authoritative — the app never treats its own DB as the source of truth for events. But hitting Google's API on every calendar render would be slow and rate-limit-risky on an old tablet, so the backend keeps a **read-optimized local mirror**:

- Background job polls Google's Calendar API using **incremental sync tokens** (Google's own cursor mechanism — cheap, only pulls what changed) every few minutes, plus a manual "refresh" trigger.
- Normalized events land in a local `events` table (see schema below); the frontend always reads from this fast local cache.
- **Writes are synchronous pass-through**: create/edit/move an event → backend calls the Google Calendar API directly → on success, updates the local cache → responds to the client. No local-only edits, no background write queue, no conflict resolution to design — since devices are basically always on WiFi, "write directly and wait for confirmation" is simpler and more correct than an offline-write model, and nothing in the requirements needs offline writes.

---

## 8. To-Do List Storage & Sync

A single flat `todos` table (dateless, as specified), with a `list` column defaulted to `'household'` — cheap forward-compatibility for a future "groceries" vs "chores" split without a migration, but v1 UI only ever shows one list. Mutations are plain REST CRUD; live sync across devices is the SSE-invalidate pattern from §3 — typically sub-second, well within "instant."

---

## 9. Voice — Deepgram Integration (v2, not v1)

Push-to-talk button → browser `MediaRecorder` captures a short clip → uploaded as one blob to the backend on release → backend calls **Deepgram's pre-recorded transcription REST endpoint** (not the streaming/WebSocket API — simpler, and for short commands the latency difference is imperceptible; streaming is a v3 optimization if it's ever needed) → transcript returned to the client and handed to the LLM layer below.

---

## 10. LLM Command Layer (v2, not v1)

This is the one place the brief explicitly calls out a hard safety constraint, and the design honors it literally: **the LLM never executes anything.** It only ever returns a structured proposal.

```
transcript ──▶ local LLM (Ollama) ──▶ JSON tool-call object
                                            │
                                            ▼
                               zod schema validation
                                            │
                              ┌─────────────┴─────────────┐
                          invalid                       valid
                              │                             │
                        reject, ask                whitelisted executor
                        user to retry              (add_todo / create_event /
                                                     move_event / etc. — a
                                                     fixed, hand-written
                                                     function per action)
```

- **LLM runtime:** Ollama running locally on the Windows PC (e.g. Llama 3.1 8B or Qwen2.5 7B instruct) — no cloud LLM call, matches "runs locally on my PC," reachable by the backend over `localhost` HTTP.
- The system prompt constrains the model to a fixed set of named actions with a defined argument shape; the response is parsed as JSON and validated with `zod` **before anything touches the database**. Anything malformed or outside the whitelist is rejected, not "best-effort" executed.
- Destructive or ambiguous actions (delete, move) get a **confirm step in the UI** ("Move Gavin's dentist appointment to Friday — confirm?") rather than silent execution — cheap insurance against a misheard transcript doing something wrong, and it keeps trust high for a nontechnical user.
- Every voice command gets logged (`voice_commands` table: transcript, parsed action, accepted/rejected) — useful for debugging misfires without adding real infra.

---

## 11. Database Schema (v1 + forward-compatible fields for v2)

```sql
CREATE TABLE todos (
  id            INTEGER PRIMARY KEY,
  text          TEXT NOT NULL,
  completed     INTEGER NOT NULL DEFAULT 0,
  list          TEXT NOT NULL DEFAULT 'household',
  position      INTEGER NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE google_accounts (
  id             INTEGER PRIMARY KEY,
  label          TEXT NOT NULL,        -- "Eric", "Wife"
  email          TEXT NOT NULL,
  access_token   TEXT NOT NULL,        -- encrypted
  refresh_token  TEXT NOT NULL,        -- encrypted
  token_expiry   TEXT NOT NULL,
  calendar_id    TEXT NOT NULL DEFAULT 'primary',
  sync_token     TEXT,                 -- Google incremental-sync cursor
  color          TEXT,                 -- per-person color coding in UI
  created_at     TEXT NOT NULL
);

CREATE TABLE events (
  id                 INTEGER PRIMARY KEY,
  google_account_id  INTEGER NOT NULL REFERENCES google_accounts(id),
  google_event_id    TEXT NOT NULL,
  title              TEXT NOT NULL,
  description        TEXT,
  location           TEXT,
  start_at           TEXT NOT NULL,   -- ISO 8601
  end_at             TEXT NOT NULL,
  all_day            INTEGER NOT NULL DEFAULT 0,
  updated_at         TEXT NOT NULL,
  UNIQUE(google_account_id, google_event_id)
);

CREATE TABLE device_sessions (
  id            INTEGER PRIMARY KEY,
  token_hash    TEXT NOT NULL UNIQUE,   -- hashed cookie token
  device_label  TEXT,                   -- "Fridge Tablet", "your wife's iPhone"
  created_at    TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL
);

-- single-row table: whole-household settings, not per-device/per-user
CREATE TABLE household_settings (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  skin          TEXT NOT NULL DEFAULT 'paper-ink',   -- 'paper-ink' | 'bold-signal' | 'soft-dynamic' | 'quiet-glass'
  updated_at    TEXT NOT NULL
);

-- v2
CREATE TABLE voice_commands (
  id             INTEGER PRIMARY KEY,
  transcript     TEXT NOT NULL,
  parsed_action  TEXT,             -- JSON
  status         TEXT NOT NULL,    -- 'accepted' | 'rejected' | 'error'
  created_at     TEXT NOT NULL
);
```

---

## 12. API Design (v1)

```
GET    /api/events?start=YYYY-MM-DD&end=YYYY-MM-DD   list events in range (from local cache)
POST   /api/events                                    create (writes through to Google)
PATCH  /api/events/:id                                 edit / move (writes through)
DELETE /api/events/:id

GET    /api/todos
POST   /api/todos
PATCH  /api/todos/:id                                  toggle complete / edit text / reorder
DELETE /api/todos/:id

GET    /api/settings                                    { skin }
PATCH  /api/settings                                    update skin (household-wide)

GET    /api/stream                                     SSE — "todos:changed" / "events:changed" / "settings:changed"

POST   /api/auth/login                                 { passcode } → sets session cookie
GET    /api/health
```

v2 adds `POST /api/voice/transcribe` and `POST /api/voice/command`.

---

## 13. Logging, Testing, Backups

**Logging:** structured JSON logs via `pino`, writing to a rotating local file (`pino/pino-roll`) plus console. No centralized log stack — total overkill for two users; if something breaks, you'll be reading the file directly.

**Testing:** pragmatic, not exhaustive. Unit tests (Vitest) for the things that are actually easy to get subtly wrong: the Google sync-token → local-cache mapping, the LLM tool-call zod validator, todo CRUD. Skip heavy e2e infrastructure for v1 while the UI is still changing fast; a handful of Playwright smoke tests (does the month view render, does the PWA install) are worth adding once the UI stabilizes, not before.

**Backups:** the only truly irreplaceable data here is the to-do list and the OAuth tokens — Google already durably stores your calendar events. A small scheduled script does `VACUUM INTO` (SQLite's consistent-snapshot backup mechanism) to copy the DB file into a synced folder (e.g. Google Drive, since you already have the account) daily, keeping ~2 weeks of rotation. No separate backup service needed.

---

## 14. Roadmap

Each milestone is independently useful/testable — nothing requires the full architecture to exist before something works.

- **M0 — Skeleton (visible ASAP).** Vite+React scaffold, Express scaffold, one page rendering in a browser. No DB, no auth, no Google. Goal: something on screen in the first session.
- **M1 — Month calendar UI.** Real month grid, tap-a-day interaction, day-detail view (including its empty state — most days have nothing scheduled), responsive tablet/iPhone layouts, CSS token system with all four skins wired up (chosen via local/hardcoded state for now) — backed by hand-entered events in local SQLite (no Google yet). De-risks all the UI work independent of OAuth complexity.
- **M2 — Shared to-do list + settings sync.** Full to-do CRUD + SSE live sync, tested across two browser tabs/devices. Same milestone stands up `household_settings` + the Settings → Appearance page, so the skin picked in M1 becomes a real synced household setting instead of hardcoded state.
- **M3 — Google Calendar integration.** One-time OAuth connect flow, sync-token polling job, local cache table, calendar UI switches from hand-entered events to real ones, writes go through to Google.
- **M4 — PWA + tablet kiosk.** Manifest, icons, service worker (app-shell caching), safe-area/notch handling, real "Add to Home Screen" test on your wife's iPhone, Fully Kiosk Browser setup on the tablet.
- **M5 — Auth + remote access.** Device-session passcode flow, Caddy + DuckDNS port setup, router forwarding, PM2 process management, backup script.

**→ v1 complete here — daily-usable without anything below.**

- **M6 (v2) — Voice input.** Mic button, MediaRecorder capture, Deepgram transcription endpoint.
- **M7 (v2) — LLM command layer.** Ollama setup, action schema + system prompt, zod validation, confirm-before-execute UI, wired to todo/calendar actions.
- **M8 (v3+) — extras.** Push notifications (iOS 16.4+ supports Web Push for installed PWAs), weather, meal planning, grocery list, per-person event colors, multiple to-do lists.

---

## 15. Future Extensibility (why the v1 schema already supports it)

- `google_accounts` supports N accounts from day one — merging your wife's personal calendar later is a config action, not a migration.
- `todos.list` exists now so "Shopping" vs "Chores" splits later without touching existing rows.
- SSE channel is generic (`events:changed` / `todos:changed`) — a new resource type later (e.g. a future `weather:changed`) reuses the same mechanism.
- The LLM tool-call whitelist is just more entries in one dispatch table — adding a new voice-controllable action never touches the validation or execution boundary.

---

## 16. Assumptions Challenged

- **Embedding Google Calendar directly** was in the original ask's "no" column and I'm confirming that's correct — a custom UI is required for the tap-to-day interaction, voice-driven actions, and iPhone-quality UX; an iframe embed can't do any of that well.
- **Continuous bidirectional sync with conflict resolution** — not needed. Google is authoritative, the local DB is a read cache, writes are synchronous pass-through. This sidesteps a genuinely hard problem (CRDTs/merge logic) that nothing in the requirements actually calls for.
- **A single shared passcode *or* full Google-login-per-use** — neither alone was right. Split "who authorizes calendar data" (one-time Google OAuth, per account) from "who can use the app day-to-day" (long-lived device-session cookie). Gets frictionless daily use without either a single forever-shared secret as the *only* control, or forcing a Google sign-in every time someone opens the fridge dashboard.
- **HTTP Basic Auth at the proxy** — the "simple default" I'd otherwise reach for — actively conflicts with the installed-iPhone-PWA requirement due to how iOS standalone mode handles auth prompts. Ruled out for that reason specifically.
- **Docker for v1** — deliberately skipped. Dev and prod run on the same physical PC; containerizing buys portability you don't need yet at the cost of a moving part you'd otherwise have to learn/debug. Code is still written in a container-friendly way (env-var config) so this is cheap to add later if you ever move off this PC.
