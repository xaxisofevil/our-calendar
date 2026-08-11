# Our Calendar — Family Dashboard Architecture

Status: Draft v1 for review
Owner: Eric
Scope: v1 (daily-usable MVP) through v3 (voice/LLM)

---

## 0. MVP Definition (confirmed)

The smallest thing your wife will actually use every day, with nothing else built:

- Custom month calendar view (fridge tablet + iPhone)
- Tap a day → see that day's events
- The app's own database is the source of truth for events (revised — see §7, this reverses the original plan to sync through Google Calendar)
- Shared, dateless household to-do list, syncing instantly across devices
- Installable iPhone PWA — tap icon, use, leave
- Lightweight auth + remote access, no VPN, no second app

Deliberately **out of v1**: voice, LLM, weather, meal planning, grocery lists. The schema and API are shaped so these bolt on later without a rewrite, but nothing in v1 depends on them. (Push notifications were originally on this list too — pulled into v1 as M5 after direct request; see §8a for why a single fixed reminder rule doesn't count as the "advanced notifications" this exclusion originally meant.)

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
                         │             │      └─▶ SQLite  │ ◀── source of truth
                         │             │                  │     for events + todos
                         │             ├─▶ Deepgram API (v2)
                         │             ├─▶ Ollama (local LLM, v2)
                         │             └─▶ MCP server (stdio, local CLI access)
                         └───────────────────────────────┘

  Internet ── DuckDNS ──▶ Raspberry Pi :8123 (Home Assistant — unrelated,
     :8123                pre-existing, untouched by this project)

Clients: fridge Android tablet (kiosk browser) · your wife's iPhone (installed PWA) · your Android phone
All clients talk to ONE origin: https://ericb.duckdns.org:8443

(No Google Calendar API in this diagram — SQLite is authoritative, not a
cache in front of Google. See §7.)
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

**Real-time sync: Server-Sent Events (SSE), not WebSockets.** The only thing that needs to be "instant" is other devices finding out the to-do list or calendar changed. That's one-directional (server → client) push of a small "something changed, refetch" signal. SSE gives you that with a plain `EventSource` on the client (auto-reconnects natively, no heartbeat/reconnect logic to write) and a single open HTTP response on the server. WebSockets would add a protocol, a library, and reconnection handling for a bidirectional channel you don't need — mutations still just go over normal POST/PATCH requests. Client pattern: mutate → optimistic UI update locally → server broadcasts an SSE event → all *other* connected clients refetch via their query cache. No CRDTs, no merge logic, no offline write queue — SQLite stays the single source of truth and every client just re-reads it.

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

This section originally split two concerns — authorizing Google Calendar data access vs. authorizing daily app use. Since §7 dropped Google Calendar as a dependency, only the second concern is real right now; the OAuth-authorization paragraph that used to live here is gone (no `google_accounts` table, no per-account consent flow — nothing to build). If Google integration is ever revisited, that's a self-contained addition to make at the time, not something v1/v2 needs to carry.

**App access (daily use):** this should **not** require Google sign-in every day, and it should **not** be one shared static password living forever with no revocation story either. The middle ground: a **long-lived device session** — visit the URL once, enter a shared setup passcode, get an HttpOnly `Secure` cookie valid for ~1 year. After that, the tablet and your wife's installed PWA are just permanently signed in — exactly the "tap and leave" experience required. This is a deliberate departure from HTTP Basic Auth at the reverse-proxy layer, which is the "simple" default I'd otherwise reach for — **iOS Safari's standalone (home-screen) PWA mode handles Basic Auth prompts unreliably**, so it actively fights the "installable iPhone PWA" requirement. An app-level cookie session avoids that entirely.

**Security boundaries:**
- Internet only ever reaches Caddy (TLS termination); the Node process isn't directly exposed.
- The session-passcode hash is hashed at rest, never sent to the frontend (no OAuth tokens exist to protect — see §7).
- No CORS needed — frontend and API are same-origin behind Caddy.
- (v2) The LLM never executes code or touches the DB directly — see §9.
- Home Assistant is out of scope for this app entirely — no code path in this project talks to it, so it's not part of the dashboard's security boundary at all.

---

## 6. Networking & Deployment

**Dev:** `npm run dev` runs Vite (frontend, hot reload) and the Express server (tsx watch) locally on your PC, both pointed at a local SQLite file — no external accounts or credentials needed to develop against, since §7's reversal made the database self-contained. No Docker, no reverse proxy, no TLS — none of that helps you iterate faster, so it's not in the dev loop at all.

**Current state (confirmed):** you have one DuckDNS hostname, `ericb.duckdns.org`, with its dynamic-DNS updater running on the Raspberry Pi, and port `8123` forwarded on your router straight to the Pi for Home Assistant. That setup is unrelated to this project and nothing below touches it.

**Adding the dashboard:** DuckDNS just keeps one hostname pointed at your home's public IP — it doesn't care how many ports you forward to how many internal devices, so this is additive, not a replacement:

- Forward a **second external port** — e.g. `8443` — on the router to the **Windows PC** (not the Pi).
- Caddy runs on the PC, terminates TLS on that port (Let's Encrypt via DuckDNS's ACME DNS-01 plugin, using the same `ericb.duckdns.org` hostname — DuckDNS supports multiple certs/ports on one hostname fine), and reverse-proxies to the local Node process.
- End result: `https://ericb.duckdns.org:8443` → dashboard, `https://ericb.duckdns.org:8123` (or however HA's currently reached) → Home Assistant, completely independent of each other. One router change, zero risk to the existing HA config.

The URL being port-suffixed and inelegant doesn't matter in practice — nobody types it, it's a one-time bookmark/home-screen-icon.

The Node process itself runs under **PM2** (simpler than a native Windows Service for a Node app — `pm2 start`, auto-restart on crash, boot-time startup via `pm2-windows-startup` in a couple of commands).

---

## 7. Calendar Data — reversed decision: local SQLite is authoritative, not Google Calendar

**This overturns the original plan.** The brief called for Google Calendar as the source of truth because that was the assumed default for "a calendar app," but M1 shipped a fully custom UI with its own storage before any Google integration existed, and it turned out nobody's missed Google Calendar — there's no other app or person outside these 4 people who needs to see this data, no school/work calendar feed being pulled in, no phone-native-calendar-widget requirement anyone's raised. Once that's true, Google Calendar sync is pure cost with no offsetting benefit: OAuth flows, encrypted token storage, refresh-token rotation, sync-token polling, API quota, an external dependency that can be down when the fridge tablet isn't — all to synchronize with a second system nobody looks at.

So: **the app's own SQLite database is the permanent source of truth for events**, not a cache in front of Google. This is a real simplification, not just a deferral:
- No OAuth, no `google_accounts` table, no token encryption/refresh machinery — none of it gets built.
- Writes are just local writes — no "call Google, then update the cache" two-step, no partial-failure states to reason about.
- The `events` table's `google_account_id` / `google_event_id` columns stay in the schema, already nullable — cheap insurance if a real reason to sync with Google ever shows up later (e.g. wanting it to appear in someone's phone's native calendar), but nothing is built toward that until an actual need appears. Section §16 (Assumptions Challenged) has the fuller reasoning.
- **This makes backups more important, not less** — Google Calendar previously provided free, durable, off-site storage of event data as a side effect of being the source of truth; losing that means the SQLite backup strategy (§13) is now the *only* durability story for real household data, not a nice-to-have. Worth pulling that forward rather than leaving it at M5 — see the M2 roadmap update.

---

## 7a. Recurring Events

Requested directly: "copy Google Calendar's exact repeat flow." Good instinct — it's a well-worn UX pattern (nontechnical users already know it), and the underlying standard (RFC 5545 `RRULE`) is worth using as the storage format even though Google Calendar is no longer synced to, because it's a mature, well-tested way to express "every Thursday," "every weekday," "monthly on the third Thursday," etc. without inventing a bespoke format, and it keeps a future Google export option cheap if it's ever wanted.

- **Storage:** one row in `events` is the "master" event; `recurrence_rule` holds a standard RRULE string (e.g. `FREQ=WEEKLY;BYDAY=TH`). No occurrence rows are materialized in the database.
- **Expansion:** occurrences are computed at *read time* — when the backend serves `GET /api/events?start=...&end=...`, any row with a `recurrence_rule` gets expanded into however many occurrences fall in the requested range (using the `rrule` npm package, not hand-rolled date math). The frontend never knows or cares whether an event it's rendering is a one-off or a recurrence — it just gets a list of dated event instances back.
- **UI, mirroring Google's flow:** the add-event sheet's "Repeats" field defaults to "Does not repeat," with quick options ("Daily," "Weekly on [day]," "Monthly on the [nth weekday]," "Annually," "Every weekday (Mon–Fri)") plus a "Custom…" option for interval + specific weekdays + an end condition (never / on a date / after N occurrences) — the same shape as Google Calendar's picker, since there's no reason to redesign a pattern this well-established.
- **Explicit v1 scope limit:** editing or deleting a recurring event affects **the whole series only** — no "just this one occurrence" support yet (that requires exception/override rows, real added complexity). If "skip just this Thursday" turns out to matter in practice, that's a well-scoped future addition, not a redesign — flagging it now as a conscious limit, not an oversight.

---

## 8. To-Do List Storage & Sync

A single flat `todos` table (dateless, as specified), with a `list` column defaulted to `'household'` — cheap forward-compatibility for a future "groceries" vs "chores" split without a migration, but v1 UI only ever shows one list. Mutations are plain REST CRUD; live sync across devices is the SSE-invalidate pattern from §3 — typically sub-second, well within "instant."

**Due dates** are an optional `due_at` on a todo (§11) — deliberately an *attribute*, not a redesign of the list into a second calendar. The list stays flat and always-visible; a due date is just something that can be shown/sorted on, same spirit as `notes`.

**Hide completed** is a pure display filter — a toggle in the to-do panel that hides (not deletes) completed items. This is per-device UI state (localStorage), not synced household data, same reasoning as light/dark mode in §4: it's about how *this screen* wants to look right now, not shared identity. No schema or backend change.

---

## 8a. Push Notifications — pulled into v1 scope

Requested directly by Lindsay, with an explicit constraint that shapes the whole design: notify about everything (any person's events, not just her own), and don't make her configure anything — one lead time, one message format, no per-event or per-person settings. The original roadmap had deferred "advanced notifications" to v3+; this isn't that — a single fixed reminder rule is about as minimal as notifications get, so it's brought forward rather than treated as the deferred "advanced" version.

- **Mechanism: standard Web Push**, not a native app and not a vendor SDK. iOS 16.4+ supports Web Push for PWAs installed to the home screen — this is *why* it has to come after M4, not before: it needs the service worker and installed-PWA context M4 sets up. The `web-push` npm package (VAPID) handles delivery from the backend; no Firebase account, no Apple Developer Program membership, no new external service to run.
- **Subscription = the entire configuration surface.** Opening the installed PWA the first time surfaces a single lightweight "Enable notifications" prompt (in-app explainer button before the native OS permission dialog, since that native dialog can only be asked cleanly once — better to ask for real intent first). Accepting registers the device's push subscription with the backend. That's the whole setup; there is no notifications settings page.
- **Trigger rule, fixed in code, not configurable:** any event — any person — starting within `NOTIFICATION_LEAD_MINUTES` (defaulting to 30) fires one push. Message format is a fixed template: `"{title} — {time} ({person})"`. Todos are explicitly out of scope for this pass (due-date reminders are a natural future extension of the exact same mechanism, not built now since it wasn't asked for).
- **Recurring-event dedup:** since §7a computes occurrences at read time rather than storing them as rows, a small `sent_reminders` table (`event_id, occurrence_start_at, sent_at`) tracks which specific occurrence already got a push, so a weekly event doesn't need any special-case logic to avoid re-notifying — the same table naturally prevents duplicates for one-off events too.
- **Sending mechanism:** a plain `setInterval` inside the already-running backend process (every 1–2 minutes), scanning events (including RRULE-expanded occurrences) starting within the lead-time window, sending via `web-push` to every row in `push_subscriptions`, recording each send in `sent_reminders`. No cron daemon, no job queue, no external scheduler — same "don't add infra that doesn't earn its keep" reasoning as everywhere else in this doc.
- **Subscriptions are per-device, not hardcoded to Lindsay** — `push_subscriptions` just stores whatever devices opted in. Right now that's practically just her phone, but nothing about the design assumes it's *only* ever her; Eric's phone or the tablet could subscribe later with zero code changes, just by tapping "enable" there too.

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

## 10a. MCP Server (M3 — explicitly earlier than voice/LLM, see roadmap)

Requested capability: drive the app from Claude Code / any MCP-capable CLI ("add milk to the list" typed at a terminal instead of tapped on a screen). Genuinely useful on its own, and not a scope detour from §10 — **it's the same action layer**, exposed a second way:

- §10's design already requires a validated, whitelisted set of actions (`add_todo`, `complete_todo`, `delete_todo`, `create_event`, `delete_event`, `move_event`, `list_events`, `list_todos`, …) with zod schemas, sitting behind the REST API. Building that as its own internal module (not scattered across Express route handlers) means it has exactly one home.
- The MCP server is a thin wrapper: each MCP tool definition calls straight into that same action module — no duplicate validation logic, no second implementation to keep in sync.
- When §10's local-LLM tool-calling layer gets built later, it becomes the *third* caller of that same module (REST API, MCP server, LLM executor). Building the MCP server now doesn't just deliver the CLI capability — it forces the action layer to exist as a clean, reusable module earlier than it otherwise would, which directly de-risks and speeds up M7.
- **Transport:** stdio, not HTTP/SSE — Claude Code runs on the same Windows PC as the backend, so a local stdio MCP server (registered once via `claude mcp add`) is the simplest correct choice. No auth/networking concerns because it never leaves the machine. Remote MCP access (e.g. from a laptop that isn't this PC) is a real but separate future step (would need HTTP transport + auth) — not needed for "ask Claude Code from the CLI" on this machine.

---

## 11. Database Schema (v1 + forward-compatible fields for v2)

```sql
CREATE TABLE todos (
  id            INTEGER PRIMARY KEY,
  text          TEXT NOT NULL,
  notes         TEXT,                       -- optional free-text detail, e.g. "leave by 2:30"
  due_at        TEXT,                       -- optional ISO 8601 date; still a flat dateless-by-default list, this is an optional attribute not a second calendar
  completed     INTEGER NOT NULL DEFAULT 0,
  list          TEXT NOT NULL DEFAULT 'household',
  position      INTEGER NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

-- A household member. Fixed set of 4 (Eric, Lindsay, Gavin, Damien),
-- hardcoded via the seed script — no editing UI planned (confirmed).
CREATE TABLE people (
  id     INTEGER PRIMARY KEY,
  label  TEXT NOT NULL,
  color  TEXT NOT NULL    -- drives the month-grid dot + event accent for this person
);

CREATE TABLE events (
  id                 INTEGER PRIMARY KEY,
  person_id          INTEGER REFERENCES people(id),   -- who it's attributed to / colored by
  title              TEXT NOT NULL,
  description        TEXT,
  location           TEXT,
  start_at           TEXT NOT NULL,   -- ISO 8601
  end_at             TEXT NOT NULL,
  all_day            INTEGER NOT NULL DEFAULT 0,
  recurrence_rule    TEXT,            -- RFC 5545 RRULE string, NULL for non-recurring events; see §7a
  updated_at         TEXT NOT NULL,
  google_account_id  INTEGER,         -- reserved, unused — see §7's "reversed decision"
  google_event_id    TEXT,            -- reserved, unused — see §7's "reversed decision"
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

-- §8a: one row per opted-in device, not scoped to a particular person
CREATE TABLE push_subscriptions (
  id            INTEGER PRIMARY KEY,
  endpoint      TEXT NOT NULL UNIQUE,
  p256dh        TEXT NOT NULL,   -- Web Push subscription key material
  auth          TEXT NOT NULL,
  device_label  TEXT,            -- "Lindsay's iPhone", best-effort/optional
  created_at    TEXT NOT NULL
);

-- §8a: dedup log so a recurring event's Nth occurrence only ever notifies
-- once, without needing occurrences to exist as real rows anywhere
CREATE TABLE sent_reminders (
  event_id           INTEGER NOT NULL REFERENCES events(id),
  occurrence_start_at TEXT NOT NULL,   -- ISO 8601; same value for non-recurring events
  sent_at            TEXT NOT NULL,
  PRIMARY KEY (event_id, occurrence_start_at)
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
GET    /api/events?start=YYYY-MM-DD&end=YYYY-MM-DD    list events in range, recurring events expanded into occurrences (§7a)
POST   /api/events                                     create (local write — see §7, no Google pass-through)
PATCH  /api/events/:id                                 edit / move (whole series, if recurring — see §7a scope limit)
DELETE /api/events/:id                                 delete (whole series, if recurring)

GET    /api/todos
POST   /api/todos
PATCH  /api/todos/:id                                  toggle complete / edit text / notes / due date / reorder
DELETE /api/todos/:id

GET    /api/people                                     read-only, seed-managed (§11)

GET    /api/settings                                    { skin }
PATCH  /api/settings                                    update skin (household-wide)

POST   /api/push/subscribe                              register a device's Web Push subscription (§8a)
DELETE /api/push/subscribe                               unsubscribe (e.g. device uninstalls the PWA)

GET    /api/stream                                     SSE — "todos:changed" / "events:changed" / "settings:changed"

POST   /api/auth/login                                 { passcode } → sets session cookie
GET    /api/health
```

v2 adds `POST /api/voice/transcribe` and `POST /api/voice/command`. The MCP server (§10a) doesn't add HTTP routes — it calls the same underlying action module the REST handlers above call, over stdio instead of HTTP.

---

## 13. Logging, Testing, Backups

**Logging:** structured JSON logs via `pino`, writing to a rotating local file (`pino/pino-roll`) plus console. No centralized log stack — total overkill for two users; if something breaks, you'll be reading the file directly.

**Testing:** pragmatic, not exhaustive. Unit tests (Vitest) for the things that are actually easy to get subtly wrong: RRULE expansion (§7a), the LLM/MCP tool-call zod validator, todo/event CRUD. Skip heavy e2e infrastructure for v1 while the UI is still changing fast; a handful of Playwright smoke tests (does the month view render, does the PWA install) are worth adding once the UI stabilizes, not before.

**Backups:** since §7's reversal, **all real household data lives only in this one SQLite file** — there's no Google-side copy acting as a fallback anymore, which makes this the single most important durability mechanism in the whole system, not a nice-to-have. A manual snapshot (`better-sqlite3`'s `.backup()`, a consistent-copy API) was already taken by hand once real events existed, into `backups/` (gitignored, outside the tracked repo). M2 formalizes this into a small scheduled script — same mechanism, run automatically — copying into a synced folder (e.g. Google Drive, since the account already exists) daily, keeping ~2 weeks of rotation. No separate backup service needed.

---

## 14. Roadmap

Each milestone is independently useful/testable — nothing requires the full architecture to exist before something works.

- **M0 — Skeleton. ✅ Done.** Vite+React scaffold, Express scaffold, one page rendering in a browser, wired end-to-end.
- **M1 — Month calendar UI. ✅ Done.** Real month grid, tap-a-day interaction, day-detail view with empty state, responsive tablet/iPhone layouts, Paper & Ink skin as real CSS tokens, add-event/add-todo flows, per-person color coding (`people` table, 4 hardcoded members) with deduplicated month-grid dots — backed by real local SQLite CRUD (events, todos), no Google (dropped entirely, see §7).
- **M2 — In progress. Live sync, and the feedback from the first real household usage:**
  - Extend SSE live-sync (already planned for todos/settings) to **events too** — this is what fixes "I had to manually refresh to see what she added." One mechanism, all three resource types.
  - **Recurring events** (§7a) — RRULE storage, read-time expansion, Google-style "Repeats…" picker.
  - **Todo due dates** (`due_at`, §8) and **hide-completed toggle** (client-side filter, §8).
  - **Delete affordance** — already exists (shipped in M1) for both events and todos; revisit its visibility/discoverability since it apparently wasn't obvious in real use — likely a sizing/placement fix, not new functionality.
  - **Formalize the backup script** (§13) — an ad-hoc snapshot was already taken by hand once real household data existed; turn that into the real scheduled script now rather than waiting for M5, since §7's reversed decision makes SQLite the only durability story.
  - Settings → Appearance page (already-planned skin picker, unchanged from earlier scope).
  - **Process for this milestone specifically:** the UX agent mocks up the new interactive pieces (recurrence picker, hide-completed toggle, due-date entry/display) directly in the real frontend using local/mock state — no schema or backend changes — for approval *before* any of the underlying infra (SSE-for-events, recurrence expansion, due-date persistence) gets built. Delete-affordance and backup-script work aren't UI-facing in the same way and don't need to wait on that approval.
- **M3 — MCP server** (§10a). Exposes the same action layer as a local stdio MCP tool set for Claude Code / any MCP-capable CLI. Explicitly pulled forward ahead of voice/LLM (below) because it forces that action layer to exist as a clean, reusable module now, which directly speeds up M7 later.
- **M4 — PWA + tablet kiosk.** Manifest, icons, service worker (app-shell caching), safe-area/notch handling, real "Add to Home Screen" test on your wife's iPhone, Fully Kiosk Browser setup on the tablet.
- **M5 — Push notifications** (§8a). Requested directly by Lindsay; placed here specifically because it has a hard dependency on M4's service worker/installed-PWA context — can't be built before it. VAPID setup, `push_subscriptions` + `sent_reminders` tables, the in-process reminder-scan interval, service worker `push`/`notificationclick` handlers, and the one-time in-app "Enable notifications" prompt (mocked for approval before the backend send-logic is built, same process as M2). Fixed 30-minute lead time and fixed message template, deliberately not configurable — see §8a for why.
- **M6 — Auth + remote access.** Device-session passcode flow, Caddy + DuckDNS port setup (networking specifics already confirmed in §6), router forwarding, PM2 process management. (Not a hard dependency for M5's push delivery itself — subscriptions send independent of remote reachability — but this is what makes subscribing/using the app reliable while away from home, so the two naturally land around the same time.)

**→ v1 complete here — daily-usable without anything below.**

- **M7 (v2) — Voice input.** Mic button, MediaRecorder capture, Deepgram transcription endpoint.
- **M8 (v2) — LLM command layer.** Ollama setup, system prompt, zod validation, confirm-before-execute UI — dispatches into the same action module M3's MCP server already built, not a parallel implementation.
- **M9 (v3+) — extras.** Weather, meal planning, grocery list, multiple to-do lists, todo due-date reminders (same mechanism as §8a, extended to todos), revisit Google Calendar sync *only* if a concrete need actually shows up (§7).

---

## 15. Future Extensibility (why the v1 schema already supports it)

- `events.google_account_id` / `google_event_id` stay in the schema, unused — reviving Google sync later (if a concrete reason ever appears) doesn't require a migration, just building the sync job against columns that already exist.
- `todos.list` exists now so "Shopping" vs "Chores" splits later without touching existing rows.
- SSE channel is generic (`events:changed` / `todos:changed`) — a new resource type later (e.g. a future `weather:changed`) reuses the same mechanism.
- The LLM tool-call whitelist is just more entries in one dispatch table — adding a new voice-controllable action never touches the validation or execution boundary.

---

## 16. Assumptions Challenged

- **Embedding Google Calendar directly** was in the original ask's "no" column and I'm confirming that's correct — a custom UI is required for the tap-to-day interaction, voice-driven actions, and iPhone-quality UX; an iframe embed can't do any of that well.
- **Google Calendar as source of truth at all** — reversed after real usage showed it added cost (OAuth, tokens, sync polling, an external dependency) with no offsetting benefit (nobody outside these 4 people needs to see this data elsewhere). Local SQLite is now the permanent source of truth; see §7 for the full reasoning. This is the biggest architectural change since v1 was first scoped, and it happened because real usage revealed the original assumption was wrong, not because it was a bad guess at the time — Google Calendar was the reasonable default before there was a working custom UI to compare it against.
- **A single shared passcode *or* full Google-login-per-use** — neither alone was right for daily app access, independent of the Google Calendar decision above. A long-lived device-session cookie gets frictionless daily use without either a single forever-shared secret as the only control, or forcing a sign-in every time someone opens the fridge dashboard.
- **HTTP Basic Auth at the proxy** — the "simple default" I'd otherwise reach for — actively conflicts with the installed-iPhone-PWA requirement due to how iOS standalone mode handles auth prompts. Ruled out for that reason specifically.
- **Docker for v1** — deliberately skipped. Dev and prod run on the same physical PC; containerizing buys portability you don't need yet at the cost of a moving part you'd otherwise have to learn/debug. Code is still written in a container-friendly way (env-var config) so this is cheap to add later if you ever move off this PC.
