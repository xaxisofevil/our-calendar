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

**Fridge tablet kiosk mode:** don't try to build kiosk behavior into the PWA — that reasoning still holds, but the plan for *how* to get there changed after this was written. The original plan was **Fully Kiosk Browser** (free tier) pointed at the dashboard URL. That's since been abandoned in favor of a free, custom root-based setup built directly on the tablet (it's already rooted via Magisk) — see §4b for the full reasoning, what replaced it, and the roadmap entry below for current status.

### PWA implementation (M4 — done)

`frontend/vite.config.ts` adds `VitePWA()` (`generateSW` strategy, the default — no hand-written service-worker source to maintain). `manifest` is inlined in the plugin config (emitted as `manifest.json`, not the default `manifest.webmanifest` name, since "a proper `manifest.json`" was the ask): `name`/`short_name` "Our Calendar", `display: "standalone"`, `start_url`/`scope: "/"`, and `theme_color`/`background_color` pulled straight from `frontend/src/styles/tokens.css`'s Paper & Ink **light-mode** values (`--color-accent` `#b0512e` / `--color-bg` `#f3ecdd`) — light mode specifically, since a manifest has exactly one static theme/background color pair and can't itself respond to `prefers-color-scheme` the way the in-app tokens do. `index.html` carries the values that live outside the manifest spec: a `theme-color` `<meta>` (browsers that read it before the manifest is parsed) and the iOS-specific tags (`apple-touch-icon`, `apple-mobile-web-app-capable`, `apple-mobile-web-app-title`) — iOS Safari's "Add to Home Screen" still leans on these rather than fully deriving everything from `manifest.json`.

**Icons** (`frontend/public/icons/`, generated by a one-off script rather than hand-drawn — no image-editing dependency in the repo): `pwa-192x192.png`, `pwa-512x512.png` (purpose `any`), `maskable-icon-512x512.png` (purpose `maskable`, glyph kept inside the ~80%-diameter safe circle so OS icon masks never clip it), `apple-touch-icon.png` (180×180, opaque background — iOS ignores alpha and fills black behind a transparent one). All four are the same simple calendar glyph (two binder-ring tabs, a header bar, a 3×2 grid of "date" squares) in `--color-accent` on `--color-bg`, per the Paper & Ink palette — deliberately a placeholder, swap for a real logo later; the point of this pass was a real, non-broken icon set, not final art.

**Caching contract, enforced deliberately, not just by omission:** `workbox` config in `vite.config.ts` sets **no `runtimeCaching` entries** — `generateSW`'s default precache (the built JS/CSS/HTML/icons only) is the *entire* cache. `/api/*` is never intercepted by the service worker, so a fetch to it when offline just fails like any uncached request, same as before the service worker existed; the existing `eventsQuery.isError` banner in `App.tsx` ("Couldn't reach the server for events…") is what surfaces that to the user, not the service worker pretending to have fresher data than it does. `workbox.navigateFallbackDenylist: [/^\/api\//]` is belt-and-suspenders on top of that (navigation fallback only ever matches document navigations anyway, never `fetch`/`XHR` calls, but keeps the intent explicit in config). **Do not add a `runtimeCaching` rule for `/api` in a future pass without re-reading this paragraph and the M4 task that produced it** — that would silently reintroduce "stale calendar/todo data presented as current," the exact failure mode this section originally ruled out.

**Verification:** `npm run build` (frontend) produces `dist/manifest.json`, `dist/sw.js`, and the icon files, with the built `sw.js`'s `precacheAndRoute()` call listing only shell assets (JS/CSS/HTML/icons/manifest — confirmed by inspecting the generated file) and zero `registerRoute`/runtime-caching entries touching `/api`. `devOptions.enabled: true` makes the same plugin register a (lighter, unbundled) service worker under plain `vite`/`vite dev` too, so the isolated e2e suite — which runs against the Vite dev server per `playwright.config.ts`, not a production build — can exercise real registration. `e2e/pwa.spec.ts` (isolated instance, `:4001`/`:4173`, see `e2e/README.md`) checks everything a Lighthouse-style installability audit checks programmatically: `manifest.json` served with the right fields and reachable icons at 192×192/512×512/maskable, `<link rel="manifest">` and the iOS meta tags present, `navigator.serviceWorker.ready` resolving with an `active` worker (localhost counts as a secure origin, satisfying the "https or localhost" installability criterion), the service worker's `CacheStorage` never containing an `/api/` entry, and — with `/api/**` routes aborted to simulate the network being down — the existing "Couldn't reach the server" banner appearing instead of the last-known data being shown as current.

**Updated for M5 (push notifications) — service worker strategy switch, `generateSW` → `injectManifest`:** `generateSW` (used above through M4) auto-generates the entire service-worker file from Workbox config — there's no hook to add a hand-written `push`/`notificationclick` listener to that generated file, which real Web Push (§8a) needs. `frontend/vite.config.ts` now sets `strategies: 'injectManifest'`, `srcDir: 'src'`, `filename: 'sw.ts'`: `frontend/src/sw.ts` is a real, hand-written, committed source file (imports `precacheAndRoute` from `workbox-precaching`, calls it on the build-injected `self.__WB_MANIFEST`, then adds its own `push`/`notificationclick`/`activate` listeners below that) — vite-plugin-pwa's only remaining job is injecting the precache manifest into it and generating `manifest.json`/icons exactly as before. `frontend/tsconfig.app.json` excludes `src/sw.ts` from its type-checked set (it needs the `webworker` TS lib via a `/// <reference lib="webworker" />`, not `dom`, and a single TS project can't mix both) — Vite/esbuild still bundles it into `dist/sw.js` normally either way.

The app-shell-only caching contract is **unchanged and re-verified**: `sw.ts` never calls `registerRoute()`/`setCatchHandler()` for anything, `/api/*` included, so it's still never intercepted or cached — confirmed both by inspecting the built `dist/sw.js` (zero `/api` substring matches) and by `e2e/pwa.spec.ts` continuing to pass unmodified against the new strategy (same assertions: empty `/api/` cache entries, "can't reach server" banner with `/api/**` blocked). This app has no client-side routing (no react-router, single always-`/` URL), so the SPA navigation-fallback behavior `generateSW`'s config used to configure (`navigateFallbackDenylist`) had nothing real to replace on the `injectManifest` side.

**What can't be automated — manual real-device checklist:**

- **iPhone — "Add to Home Screen" (real Safari, not a simulator):**
  1. Open `https://<the deployed URL>` in mobile Safari (not Chrome-on-iOS — it can't install PWAs on iOS; this only works from Safari).
  2. Tap the Share icon → "Add to Home Screen" → confirm the name reads "Our Calendar" and the icon shows the calendar glyph (not a broken-image placeholder).
  3. Launch from the home-screen icon and confirm it opens `display: standalone` — no Safari address bar/tab chrome, just the app.
  4. Confirm the icon/splash background reads correctly against both iOS light and dark home screens.
  5. Put the phone in Airplane Mode, relaunch the installed app, and confirm it shows the "can't reach server" banner rather than a blank screen or stale data — this is the one behavior that most needs a real device+network stack to trust, since Wi-Fi-off-vs-server-down-vs-DNS-failure can behave subtly differently between a browser's simulated offline mode and an actual dead connection.
  6. Revisit once M5 (push notifications) lands — iOS 16.4+ only supports Web Push for PWAs installed exactly this way, so this checklist step is also what unblocks that milestone.
- **Fridge Android tablet — superseded, nothing left to check off here.** This item used to describe a Fully Kiosk Browser setup; that plan was abandoned (Fully Kiosk's needed features are paid-tier only, and the direct instruction was "I don't want to pay anything" — see §4b) in favor of a free, custom root-based kiosk setup, which has already been built and tested for real on the device — round-tripped through multiple full reboot cycles, not just exited-without-error. See §4b for the full writeup and verification detail.

---

## 4a. Add-Event Sheet — Time Defaults (direct feedback)

Two small but real UX nits, fixed in `AddEventSheet.tsx`:

- **Default start time was a hardcoded 3pm.** Wrong for exactly half the day — if it's already past 3pm, that default is behind the clock, which reads as a bug on a "new event." Fixed: default start time is now the current real time rounded up to the next half-hour (`roundedUpTimeString`), so it's never in the past regardless of when the sheet is opened. Default duration is 30 minutes (was 60).
- **Changing start time didn't move end time.** Matches Google Calendar's create-flow now: end time follows start time (30 minutes later) until the user directly edits end time themselves — tracked via `endTimeManuallySet`, reset each time the sheet opens fresh, so it never carries over into a later session. Only applies while creating (or actively editing within one open session); doesn't retroactively shift an existing event's real duration when you open it to edit something unrelated.

**This fix indirectly surfaced two real, pre-existing latent bugs** — see §7a's "Bug found and fixed" note — because it made evening default times possible for the first time; every prior default was a fixed mid-afternoon time nowhere near a UTC day boundary.

---

## 4b. Fridge Tablet Kiosk Mode — root-based, not Fully Kiosk Browser (M4 — done)

**This reverses §4's original kiosk-mode plan.** §4 originally called for Fully Kiosk Browser (free tier) pointed at the dashboard URL. That's abandoned now: the day/night screen behavior actually wanted here — a real idle-dim screensaver, plus motion/touch-based wake scheduling — lives behind Fully Kiosk's Plus license, not its free tier, and the direct instruction was blunt: "I don't want to pay anything." Rather than compromise the day/night behavior to fit the free tier, or pay for Plus, a different path opened up: the tablet in question — a Samsung Galaxy Tab A8, borrowed from the household's kids, mounted on the fridge as the shared family calendar display, occasionally taken off the fridge for trips — is already rooted via Magisk. A fully free, custom root-based kiosk setup was built instead, using nothing but Magisk's own boot-script hook and free F-Droid/GitHub-released apps. No paid software anywhere in this design.

Because the tablet is genuinely shared (the kids' tablet, not a dedicated display bought for this purpose), "kiosk mode" here had to mean more than "lock it into the app forever" — it had to be reversible, on-device, without a computer, so it can go back to being a normal tablet for a trip and come back to being the calendar display afterward. That reversibility requirement shaped as much of what follows as the display behavior itself did.

**The brightness/power daemon** (`/data/adb/service.d/calendar-tablet.sh`) is the core of it. Magisk runs every script in `/data/adb/service.d/*.sh` as root automatically on boot — no separate app, no foreground service to keep alive, just a shell script Magisk itself is responsible for starting. It implements a day/night screen state machine, per spec:
- **Day (6am–8pm):** screen stays on continuously — `screen_off_timeout` is set to `2147483647` (effectively "never"), specifically so the daemon, not Android's own timeout, is the sole authority over the screen during this window. Full brightness (255) while the screen is being touched, dimming to ~15% (38) after 20 seconds of no touch. Touch detection is a poll loop against `/dev/input/event5` — the touchscreen device, identified as "himax-touchscreen" via `getevent -il` and confirmed stable across multiple reboots on this specific unit — using `timeout N getevent -c 1 <dev>`: if that call times out, the screen's idle; if it returns before the timeout, it was touched.
- **Night (8pm–6am):** screen off. `screen_off_timeout` drops to 15000ms so Android puts itself to sleep quickly once idle. Waking it relies on this device's native "Double tap to wake" hardware feature (confirmed via `settings get secure double_tap_to_wake` = 1 — a real firmware capability already present on this tablet, not something this script adds), to a fixed 30% brightness (77/255) — set proactively at the moment the day→night transition happens, not reactively after the next wake, so there's no flash-bright-then-correct on the first touch of the night.

**Three prerequisite Android settings**, each found by real debugging, not anticipated up front:

1. **Lock screen had to be fully disabled** (`locksettings set-disabled true`, `wm dismiss-keyguard`, and ultimately a reboot — disabling future re-locks doesn't dismiss whatever keyguard window is already active). Root cause: `dumpsys power` showed `mUserActivityTimeoutOverrideFromWindowManager=5000` — while sitting at the keyguard, Android forces the screen back off ~5 seconds after any wake, as a battery-saving measure before anyone unlocks, completely ignoring whatever `screen_off_timeout` the daemon had set. Confirmed still broken via `dumpsys window policy` showing `showing=true` for the keyguard even after `locksettings set-disabled true` — until a reboot actually cleared it.
2. **Screensaver / Doze ambient dream had to be disabled** (`settings put secure screensaver_enabled 0`, `settings put secure doze_enabled 0`). Root cause: even with the lock screen gone, the screen was still observed going dark on its own — `dumpsys dreams` showed `mCurrentDreamIsDozing=true`, `mCurrentDreamDozeScreenState=OFF`. Android's own DreamManagerService/ambient-display subsystem was independently taking control of the display, overriding the daemon's own brightness/power calls regardless of what they set.
3. **Auto-brightness had to be off** (`settings put system screen_brightness_mode 0`) — otherwise the light sensor fights every brightness write the daemon makes.

**Real bugs found and fixed in the daemon script itself:**

1. **Root cause:** Magisk's `service.d` scripts run early enough in boot that `system_server` hasn't finished registering core services yet — the first boot after installing the daemon logged `settings put`/`input keyevent` both failing with "Can't find service," even though the script itself completed without error. **Fix:** a `wait_for_system_ready()` function polls `settings get system screen_brightness` (a harmless read) up to 90 times at 2-second intervals before trusting any writes, plus a flat 5-second buffer once that succeeds, for sibling services (`input`, etc.) to finish registering too.
2. **Root cause:** Magisk executes `service.d` scripts with its own bundled BusyBox ahead of `/system/bin` on `PATH`. BusyBox's `timeout` applet returns a different exit code on timeout than the system's own `timeout` (a toybox symlink at `/system/bin/timeout`) does, so the idle-check's `[ $? -ne 124 ]` test — 124 being the GNU/toybox convention for "killed by timeout" — silently never matched under BusyBox, meaning every idle-check looked like "touched," and brightness never dimmed, for many minutes past the intended 20-second threshold. Confirmed by watching brightness stay pinned at full for multiple full idle cycles when it should have dimmed. **Diagnosis:** the identical `timeout N getevent -c 1 <dev>` command, run standalone from a normal (non-Magisk-context) root shell, correctly returned exit code 124 — proving the command itself was fine and the execution context (BusyBox's PATH shadowing) was the actual problem. **Fix:** every command the daemon uses (`settings`, `input`, `dumpsys`, `timeout`, `getevent`) is now pinned to its absolute `/system/bin/*` path, sidestepping PATH resolution entirely rather than depending on two different `timeout` implementations agreeing on an exit code.
3. **Root cause:** on one boot, brightness was observed still sitting at a stale pre-boot value long after the "mode -> day" transition had already logged as complete — `wait_for_system_ready()` plus its fixed 5-second buffer turned out not to be a hard guarantee that every service the daemon touches is actually ready the instant it returns; it can still race a slow boot. **Fix:** the two critical settings-writing functions (`set_brightness`, `set_timeout`) are now self-verifying — write, read back immediately, retry up to 5 times with 1-second waits if the read-back doesn't match, log a WARNING if it never verifies after all 5 attempts. **Verified** by deliberately leaving `screen_brightness` at a wrong value (1) immediately before a reboot, then confirming after boot that it had self-corrected to the correct day-mode value (255) despite starting wrong.
4. **Root cause:** the daemon was found silently killed at some point — no crash trace in its own log, no reboot, it just stopped appending lines after a normal "mode -> night" entry — during a period of real memory pressure caused by installing and bootstrapping Termux (a large toolchain extraction) in a separate, later piece of work on the same device. A plain background shell loop has no protection from Android's low-memory killer by default, unlike Magisk's own core daemon process. **Fix:** the daemon writes `-1000` to `/proc/$$/oom_score_adj` at startup — the standard technique for marking a process OOM-immune, matching how system-critical daemons protect themselves. **Verified** by confirming the value landed on the live process's `/proc/<pid>/oom_score_adj` after a fresh boot, and by the daemon surviving the same kind of memory-pressure event afterward without incident.

**Mode-switching scripts**, built because this is the kids' shared tablet and it has to go back to being a normal, unrestricted tablet for trips without needing a computer:
- `kiosk-mode.sh` — disables lock screen/screensaver/doze/auto-brightness, installs the daemon (the daemon script is embedded inline via heredoc, so this one file is fully self-contained — no dependency on a separate file existing anywhere), reboots to apply everything cleanly.
- `normal-mode.sh` — stops and removes the daemon (kills the running process first, *then* removes it from `service.d` and restores settings, in that order specifically, so the daemon can't re-fight the restored values mid-transition), re-enables lock screen/screensaver/doze/auto-brightness, restores the tablet's actual original `screen_off_timeout` (600000ms/10min, captured before any of this work began) and a reasonable default brightness, reboots.
- Both live at `/sdcard/CalendarTablet/` on the tablet — runnable entirely on-device via a root shell (e.g. Termux, below), no ADB/computer connection needed once set up. Both were tested for real, round-trip, across multiple full reboot cycles each, confirming every setting actually lands correctly afterward each time — not just that the script exits without error.
- Every reboot-dependent step here was empirically required, not a convenience choice: ad-hoc "activate without rebooting" attempts (backgrounding via nohup/setsid from a transient shell) were tried first and found unreliable in this specific environment — background jobs didn't reliably survive session detachment. A full reboot was the one mechanism that worked correctly every time it was tested.

**Tap-to-run home screen icons**, so switching modes doesn't require a terminal or typing:
- Termux (v0.118.3, arm64-v8a) and Termux:Widget (v0.15.0) — both free, downloaded directly from their GitHub releases (not the Play Store build, which is outdated/broken) and sha256-checksum-verified against the officially published checksums before installing. Installed via `adb install`, which required temporarily disabling Samsung's package verifier (`settings put global verifier_verify_adb_installs 0`, `package_verifier_enable 0` — it blocks ADB-sideloaded APKs by default on this device) and re-enabling it afterward.
- Two tiny launcher scripts (`Calendar_Mode.sh`, `Kid_Mode.sh`, each just `su -c "sh /sdcard/CalendarTablet/<kiosk-mode.sh|normal-mode.sh>"`) placed in Termux's `~/.shortcuts/` (`/data/data/com.termux/files/home/.shortcuts/`) — Termux:Widget's documented mechanism for turning any script there into a tap-to-run button on a placeable home-screen widget. Required fixing file ownership/SELinux context: root-created files defaulted to `root:root` ownership with the wrong SELinux context for Termux's own app sandbox to read them, fixed via `chown` to Termux's actual app uid and `restorecon`.
- Magisk root access was pre-granted directly to Termux's uid via `magisk --sqlite "INSERT OR REPLACE INTO policies (uid, policy, until, logging, notification) VALUES (<termux-uid>, 2, 0, 1, 1)"` (matching the schema/values of apps already granted root in that table), so there's no interactive "grant root?" popup the first time either button is tapped.
- One step genuinely can't be done remotely, and is left as the final manual step: long-press the home screen → Widgets → Termux:Widget → drag it onto the home screen, which then shows as a small list with the two tap-to-run buttons.

**Status:** the daemon, both mode-switch scripts, and the widget icons are fully done and tested for real on the actual tablet. The one thing this doesn't touch is §4's iPhone "Add to Home Screen" manual test — see the M4 roadmap entry below; its status is unchanged and unconfirmed by this work.

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

**Login hardening (added once port 8443 was actually forwarded to the internet):**
- **Passcode strength is the household's responsibility, not a technical control** — since it's typed once per device ever (the cookie handles every visit after), a memorable multi-word passphrase costs nothing in daily friction while resisting guessing far better than a short PIN. No "forgot passcode" self-service recovery exists in v1 — losing it means changing `AUTH_PASSCODE` and restarting, not a reset flow, so it's worth writing down somewhere durable (password manager, note) rather than trusting memory alone.
- **Rate limiting on `POST /api/auth/login`** (`express-rate-limit`, scoped to that one route, not all of `/api/*` — the threat is repeated passcode guesses, not normal app traffic): 10 failed attempts per 15 minutes per IP. `skipSuccessfulRequests: true` — only failures count, so a family member correctly re-entering the passcode on several devices never risks tripping it. Once the failure budget IS exhausted, every request (even a correct one) is blocked until the window resets — the limiter can't know a request is "correct" without letting it through to the handler first, so this is intended anti-brute-force behavior, not a bug.
- **`app.set("trust proxy", 1)`** — required for the rate limiter (or anything IP-based) to see the real client IP through Caddy's reverse proxy in production, rather than everyone sharing one bucket keyed to Caddy's own localhost address. Harmless in dev (no proxy in front).
- **`helmet`** for baseline security headers (X-Frame-Options, X-Content-Type-Options, etc.) — near-zero config cost for anything reachable from the internet. Two of its defaults are turned off, both empirically isolated by bisecting each policy against the full e2e suite rather than guessed: `contentSecurityPolicy` (its default assumes a classic server-rendered page, not this SPA's Vite bundle) and `crossOriginOpenerPolicy` (broke SSE live-sync between two simultaneously open pages — reproduced 100% of the time with it on, 0% with it off, across repeated runs; COOP's Spectre-style browsing-context isolation isn't a meaningful loss for this app's actual threat model, and `crossOriginResourcePolicy` — kept at its default — still blocks other origins from loading this app's resources).

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

### Production deployment (M5 — implemented)

**Caddy build note:** the plain `winget`/caddyserver.com download does **not** include DNS provider plugins (needed for the DNS-01 challenge above) — those are opt-in at build time. Caddy's official site exposes a public build API for exactly this (the same mechanism their own download page uses), so no local Go/xcaddy toolchain install was needed:
```
curl -sL "https://caddyserver.com/api/download?os=windows&arch=amd64&p=github.com/caddy-dns/duckdns" -o caddy.exe
```
This binary (with the `dns.providers.duckdns` module compiled in) lives at `C:\caddy\caddy.exe` — deliberately **outside** the repo, same reasoning as Node.js itself: a system-level tool, not project source. `deploy/Caddyfile` and `deploy/ecosystem.config.cjs` **are** committed to the repo (they only reference env vars, never contain the actual secrets).

**PM2 manages both processes** — the backend AND Caddy — rather than introducing a second service-management tool (e.g. NSSM) just for Caddy. `pm2-windows-startup` gives both boot-time persistence through one mechanism.

**One-time setup checklist** (manual — needs router/account access only you have):
1. **Router:** forward external port `8443` to this PC's LAN IP, per the plan above. (Port `8123`→Pi for Home Assistant stays untouched.)
2. **DuckDNS token:** log into duckdns.org, copy the token shown on your account page.
3. **Set both required env vars** at the User or Machine level (so they persist across reboots/new sessions — e.g. via `[Environment]::SetEnvironmentVariable("DUCKDNS_API_TOKEN", "...", "User")` in an elevated PowerShell, then open a **fresh** shell so it's picked up):
   - `DUCKDNS_API_TOKEN` — from step 2.
   - `AUTH_PASSCODE` — choose a real passcode for daily device-session login (§5). Not auto-generated; this is a household decision, not a technical one.
4. **Build the frontend for production:** `npm run build` in `frontend/` (emits `frontend/dist`, which the Caddyfile serves directly).
5. **Build the backend:** `npm run build` in `backend/` (emits `backend/dist/index.js`, per its existing `package.json` scripts).
6. **Start everything:**
   ```
   pm2 start deploy/ecosystem.config.cjs
   pm2 save
   pm2-startup install
   ```
7. Visit `https://ericb.duckdns.org:8443`, enter the passcode once — the resulting device-session cookie (§5) is what makes every visit after that frictionless, on every device.

Validated pre-rollout: `caddy validate --config deploy/Caddyfile` confirms the Caddyfile parses correctly and the DuckDNS DNS module resolves. The stack wasn't started for real during development — doing so would collide with the dev-mode servers already running on the same ports, and shouldn't go live before the router forward + real token/passcode are actually in place.

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

**Bug found and fixed (discovered indirectly, via the add-event default-time fix in §4a):** for evening events, the master row's real UTC `start_at` can land on a *different UTC calendar day/weekday* than its true local one (e.g. 10pm EDT is already past midnight UTC). Two distinct problems came from this, both now fixed in `backend/src/`:
1. **`GET /api/events` could silently exclude the event entirely.** `actions/events.ts` built its query window by literally appending `T00:00:00.000Z`/`T23:59:59.999Z` to the frontend's local calendar-day strings — treating a *local* day as if it were a *UTC* day. Fixed by widening the query window by a ±24h safety margin (comfortably covers every real-world UTC offset) before querying; the frontend's own `dateKey`-based grouping (already correctly local-timezone-aware via date-fns) does the precise day-bucketing for display, so a little query-side over-fetch at the edges is harmless.
2. **A late-evening recurring event's first occurrence was silently skipped, starting the whole series a week late.** `lib/recurrence.ts`'s RRULE `BYDAY` is authored from the event's *local* weekday, but `rrule` (the npm package) computes weekday-matching against `dtstart` using **UTC** getters internally — a documented convention of that library, not a bug in it. When the true UTC weekday of `dtstart` disagreed with the local weekday the rule was written against, `rrule` correctly (per its own semantics) treated the literal `dtstart` as "the wrong weekday" and started generating from the next real match — a week later than intended. Fixed with the standard "floating time" technique: every Date crossing into/out of the `rrule` library is converted to/from a representation whose *UTC* component values equal this app's *local* component values (`toFloating`/`fromFloating` in `lib/recurrence.ts`), so `rrule`'s internal UTC-based math ends up reasoning in local wall-clock terms — matching how the rule was authored. This assumes the server and the household's devices share one timezone, same as everywhere else in this app that no timezone is ever transmitted client→server — a reasonable assumption for one home, not something a multi-timezone product could get away with.

Neither bug was ever exercised by existing tests or (apparently) real usage, because every add-event default before this session was a fixed mid-afternoon time — nowhere near a UTC day boundary. It surfaced once §4a's default-start-time fix made evening defaults possible.

---

## 8. To-Do List Storage & Sync

A single flat `todos` table (dateless, as specified), with a `list` column defaulted to `'household'` — cheap forward-compatibility for a future "groceries" vs "chores" split without a migration, but v1 UI only ever shows one list. Mutations are plain REST CRUD; live sync across devices is the SSE-invalidate pattern from §3 — typically sub-second, well within "instant."

**Due dates** are an optional `due_at` on a todo (§11) — deliberately an *attribute*, not a redesign of the list into a second calendar. The list stays flat and always-visible; a due date is just something that can be shown/sorted on, same spirit as `notes`.

**What happens when a todo passes its due date:** purely visual, deliberately. An incomplete todo with `due_at` in the past is "overdue" — it keeps its already-designed accent-colored pill/label, and **incomplete overdue items float to the top of the list** (most-overdue first), above incomplete items that aren't yet due. Completed items are unaffected by due-date sorting (and hidden entirely if "hide completed" is on). **Nothing else happens automatically** — no auto-deletion, no escalating reminders, no auto-moving to another list. This is a conscious choice: it's a shared household list, not a task-management app, and silently mutating something a family member entered the moment it's late would be a bad surprise, not a helpful one. If overdue-todo push reminders are ever wanted, that's the same mechanism as §8a extended to todos (already noted as a deferred M9 item) — not built now.

**Hide completed** is a pure display filter — a toggle in the to-do panel that hides (not deletes) completed items. This is per-device UI state (localStorage), not synced household data, same reasoning as light/dark mode in §4: it's about how *this screen* wants to look right now, not shared identity. No schema or backend change.

---

## 8a. Push Notifications — pulled into v1 scope

Requested directly by Lindsay, with an explicit constraint that shapes the whole design: notify about everything (any person's events, not just her own), and don't make her configure anything — one lead time, one message format, no per-event or per-person settings. The original roadmap had deferred "advanced notifications" to v3+; this isn't that — a single fixed reminder rule is about as minimal as notifications get, so it's brought forward rather than treated as the deferred "advanced" version.

- **Mechanism: standard Web Push**, not a native app and not a vendor SDK. iOS 16.4+ supports Web Push for PWAs installed to the home screen — this is *why* it has to come after M4, not before: it needs the service worker and installed-PWA context M4 sets up. The `web-push` npm package (VAPID) handles delivery from the backend; no Firebase account, no Apple Developer Program membership, no new external service to run.
- **Subscription = the entire configuration surface.** Opening the installed PWA the first time surfaces a single lightweight "Enable notifications" prompt (in-app explainer button before the native OS permission dialog, since that native dialog can only be asked cleanly once — better to ask for real intent first). Accepting registers the device's push subscription with the backend. That's the whole setup; there is no notifications settings page.
- **Trigger rule, fixed in code, not configurable:** any event — any person — starting within `NOTIFICATION_LEAD_MINUTES` (defaulting to 30) fires one push. Todos are explicitly out of scope for this pass (due-date reminders are a natural future extension of the exact same mechanism, not built now since it wasn't asked for).
- **Message format, revised after real-device testing:** originally a single combined string (`"{title} — {time} ({person})"`) sent as the notification body under a generic "Our Calendar" title. Real testing showed this wastes the OS notification's most-prominent text (the bold title line) on the app name — something already visible from the notification's own icon — while the actually-useful information (which event) sits smaller in the body. Fixed: **`title` is the event's own title**, **`body` is `"{time} · {person}"`** — the event leads, not the app.
- **Recurring-event dedup:** since §7a computes occurrences at read time rather than storing them as rows, a small `sent_reminders` table (`event_id, occurrence_start_at, sent_at`) tracks which specific occurrence already got a push, so a weekly event doesn't need any special-case logic to avoid re-notifying — the same table naturally prevents duplicates for one-off events too.
- **Sending mechanism:** a plain `setInterval` inside the already-running backend process (every 1–2 minutes), scanning events (including RRULE-expanded occurrences) starting within the lead-time window, sending via `web-push` to every row in `push_subscriptions`, recording each send in `sent_reminders`. No cron daemon, no job queue, no external scheduler — same "don't add infra that doesn't earn its keep" reasoning as everywhere else in this doc.
- **Subscriptions are per-device, not hardcoded to Lindsay** — `push_subscriptions` just stores whatever devices opted in. Right now that's practically just her phone, but nothing about the design assumes it's *only* ever her; Eric's phone or the tablet could subscribe later with zero code changes, just by tapping "enable" there too.

### Implementation (M5 — done)

**VAPID keys:** generated once via `web-push`'s `generateVAPIDKeys()` utility (plain EC keypair, not tied to any account — see `backend/.env.example`'s inline command). Stored as `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` env vars (`backend/.env.example`, same pattern/placement as `AUTH_PASSCODE`), plus an optional `VAPID_SUBJECT` (contact URI some push services use, defaults to a placeholder rather than hardcoding a real address in source). `VAPID_PUBLIC_KEY` isn't secret and also needs to reach the frontend build as `VITE_VAPID_PUBLIC_KEY` (`frontend/.env.example`, same value) so the browser can pass it to `pushManager.subscribe()`. Leaving either backend key unset is a deliberate no-op, not a crash — `lib/reminders.ts`'s `ensureVapid()` mirrors `middleware/requireAuth.ts`'s existing "escape hatch until configured" pattern (§5); leaving the frontend one unset makes `enablePushNotifications()` return `"unsupported"` instead of throwing.

**Schema:** `push_subscriptions` and `sent_reminders`, exactly as specified in §11 (`backend/src/db/schema.ts` + the raw-SQL `CREATE TABLE IF NOT EXISTS` block in `backend/src/db/client.ts`, matching this project's existing pre-migrations pattern).

**Backend routes/actions:** `backend/src/actions/push.ts` (`subscribePush`/`unsubscribePush`) follows the same action-layer pattern as M3's `events.ts`/`todos.ts` — zod-validated (`lib/validation.ts`'s `subscribePushSchema`/`unsubscribePushSchema`), throwing the same `ActionValidationError`, exported from the `actions/index.ts` barrel. `routes/push.ts` is a thin REST translation layer over it, mounted at `/api/push` behind the same `requireAuth` gate as every other `/api/*` route. `subscribePush` upserts on `endpoint` (`UNIQUE` in the schema) rather than erroring on a re-subscribe; `unsubscribePush` is deliberately idempotent (unsubscribing an endpoint that's already gone still returns `204`, not `404` — the caller's desired end state already holds). Not yet wired into the MCP server (§10a) — there's no real CLI use case for "subscribe this terminal to push" — but living in the action layer already makes that trivial whenever it is.

**Recurrence reuse:** `actions/events.ts`'s `listEvents` was refactored to extract `listEventsBetween(rangeStart: Date, rangeEnd: Date)` — the same query-and-expand logic (still built on `lib/recurrence.ts`'s `expandOccurrences`, §7a), just taking precise `Date` bounds instead of day-granularity `YYYY-MM-DD` strings. `listEvents` (REST/MCP, day-range callers) and the reminder scanner (below, a minute-precision lead-time window) both call this one function — no second recurrence-expansion implementation anywhere.

**Sending mechanism:** `backend/src/lib/reminders.ts`'s `scanAndSendReminders()`, wired into a plain `setInterval` in `index.ts` (runs once immediately on boot too, so a reminder due right after a restart doesn't wait a full interval) — exactly per spec, no cron daemon, no job queue. `NOTIFICATION_LEAD_MINUTES` (30) and `REMINDER_SCAN_INTERVAL_MS` (90s, the middle of the "1–2 minutes" spec, overridable via env var for the e2e harness) are real, documented constants in `backend/src/lib/constants.ts` — the one actual *definition*; `frontend/src/lib/imminent.ts`'s same-valued constant is an intentional, commented duplicate (§8b), since the two packages share no module to import across. Each scan pass: calls `listEventsBetween(now, now + 30min)`, skips anything already in `sent_reminders`, and for each qualifying occurrence sends the fixed `"{title} — {time} ({person})"` template (as a JSON push payload's `body`, with `title: "Our Calendar"`) to every row in `push_subscriptions` via `web-push`, then records the occurrence in `sent_reminders` once — regardless of individual per-subscriber delivery failures, so one dead endpoint can't make an occurrence retry forever. A `404`/`410` response from a push service (subscription gone) deletes that `push_subscriptions` row on the spot.

**Service worker:** switched `generateSW` → `injectManifest` — see §4's "PWA implementation" subsection for the full reasoning and the preserved app-shell-only caching contract. `frontend/src/sw.ts` adds real `push` (parses the backend's JSON payload, calls `registration.showNotification`) and `notificationclick` (focuses an existing tab or opens `/` — no per-event deep link, v1 scope) listeners, plus `skipWaiting`/`clients.claim()` on `activate` to match the M4 config's `autoUpdate` behavior it replaces.

**Frontend wiring:** `frontend/src/lib/push.ts`'s `enablePushNotifications()` is the entire flow `NotificationPrompt.tsx`'s already-approved "Enable notifications" button now calls (UI shell untouched, per §8a's own instruction not to redesign it) — `Notification.requestPermission()` → `navigator.serviceWorker.ready` → `pushManager.subscribe()` (using `VITE_VAPID_PUBLIC_KEY`, base64url-decoded to the `Uint8Array` the Push API wants) → `POST /api/push/subscribe`. Resolves with an outcome (`"subscribed" | "denied" | "unsupported" | "error"`) rather than throwing; `App.tsx`'s `handleEnableNotifications` dismisses the prompt either way, since §8a's "no settings page" design means there's nowhere to retry from on failure/denial. "Not now" is unchanged — a plain dismiss. A `disablePushNotifications()` counterpart exists in the same file (unsubscribes locally + calls `DELETE /api/push/subscribe`) but isn't wired to any UI yet, since v1 has no "turn off notifications" affordance to call it from.

**Verification:** `e2e/push-notifications.spec.ts` (isolated instance, a throwaway VAPID keypair and a sped-up `REMINDER_SCAN_INTERVAL_MS` configured only for that backend — see `e2e/helpers.ts`) covers: subscribe persists a row and upserts (not duplicates) on re-subscribe; malformed-body rejection; unsubscribe removes the row and is idempotent; the reminder scan finds a qualifying occurrence, sends (mock endpoints deliberately fail delivery — this also exercises the per-subscriber error-handling path for real, not just in theory), and records it in `sent_reminders` exactly once across multiple scan ticks; an occurrence outside the lead window is correctly never recorded; and the real "Enable notifications" UI flow end-to-end with the browser's `Notification`/`PushManager` APIs mocked (no real device/push-service delivery is possible from an automated suite). `push_subscriptions`/`sent_reminders` have no REST read endpoint (by design, §12), so these assertions read the isolated e2e SQLite file directly (`e2e/db.ts`) rather than the real dev/prod database. Full suite: 89/89 passing, including `e2e/pwa.spec.ts` unmodified and still green against the new service-worker strategy.

**Real incident — a production build can silently ship with no VAPID key.** Found via direct report: neither Lindsay's phone nor the tablet ever showed *any* native permission prompt (not even Chrome's "quiet" address-bar icon) when tapping "Enable notifications." Root cause: `VITE_VAPID_PUBLIC_KEY` is a Windows User-level env var on the deploy machine, but a rebuild was run from a shell whose parent process predated that var being set — Windows doesn't propagate newly-set persistent env vars to already-running processes. `npm run build` completed with no error or warning, silently baking a bundle with the key missing; `enablePushNotifications()` (`frontend/src/lib/push.ts`) returns `"unsupported"` immediately whenever the key is falsy, so `Notification.requestPermission()` was never even called — indistinguishable from working correctly unless someone actually checks the browser's own site-permissions list. Fixed the build itself (rebuilt with the key correctly set, verified by grepping the built bundle for the key's literal bytes, redeployed), and hardened `frontend/vite.config.ts` to throw immediately during `npm run build` specifically (not `vite dev`/`vite preview`/the e2e harness, which legitimately don't always need it) if the key is unset — so this fails loud at build time instead of silently shipping broken.

**What can't be automated — manual real-device verification checklist** (do this once actually deployed, i.e. after M6; §4's own iPhone checklist step 6 points here):

1. On the installed iPhone PWA (§4's "Add to Home Screen" checklist must be done first — Web Push for installed PWAs is iOS 16.4+-only, and only works from the home-screen-installed app, not a regular Safari tab), tap "Enable notifications" on first launch and grant the OS permission prompt.
2. Confirm a row appears in `push_subscriptions` (e.g. via `sqlite3 backend/data/our-calendar.sqlite "select id, device_label, created_at from push_subscriptions;"` on the server, read-only) shortly after.
3. Create (or wait for) an event starting within the next 30 minutes, attributed to any household member — not just whoever subscribed, per §8a's "notify about everything" requirement.
4. Within the next scan cycle (≤ ~2 minutes), confirm the phone receives a real OS notification reading `"{title} — {time} ({person})"`.
5. Tap the notification and confirm it brings the installed PWA to the foreground (or opens it if it wasn't running).
6. Wait for the same event's next scan cycle (or restart the backend process) and confirm it does **not** notify again — the `sent_reminders` dedup working for real, not just in the isolated test DB.
7. For a weekly recurring event, confirm only the occurrence actually within the lead window ever notifies — not the whole series at once, and not the same occurrence twice across restarts.
8. Uninstall the PWA (or manually call the app's future "disable notifications" path once one exists) and confirm no further pushes arrive for that device.

---

## 8b. Imminent-Event Highlighting (fridge tablet + day-detail)

A purely visual companion to §8a's push, for the screen that's already glanceable: an event starting soon should be *visibly* about to happen, not just eventually pushed to a phone. Reuses §8a's exact lead-time constant (`NOTIFICATION_LEAD_MINUTES`, default 30) as "imminent" — one concept, two surfaces, not a second magic number to keep in sync.

- **Color, deliberately not literal red:** a slow pulse using the active skin's own accent token (`--color-accent`, fading toward white/background and back), not a hard red alarm color. Red is UI shorthand for "something is wrong"; this is "something's coming up," and a wall-mounted kitchen display that kids also see shouldn't read as alarming for a routine reminder. Each skin gets to define its own pulse tone via its existing tokens — this isn't a hardcoded color, it's a hardcoded *behavior* applied through whichever skin is active (§4).
- **Scope, deliberately narrow:** only two places pulse — the month-grid dot for that day, and the event's own row in the day-detail panel if that day happens to be selected/visible. Never the whole page, header, or tab — a glance should catch it without the UI feeling like it's shouting continuously.
- **Mechanism, kept cheap for an older tablet:** a lightweight client-side timer (every 30–60s, not every frame) recomputes which currently-loaded events fall inside the imminent window and toggles a CSS class; the actual pulse is a plain CSS `@keyframes` animation on `background-color`/`opacity`, which the browser compositor handles cheaply on its own — no per-frame JS, no canvas, nothing that would tax weaker hardware even left running for hours. The class is removed automatically once the event's start time passes (an event starting now stops being "upcoming," it's just happening — no lingering pulse for events already underway).
- **Accessibility:** respects `prefers-reduced-motion` (an existing media-query pattern already in `index.css`) by swapping the animation for a static tinted highlight instead of an ongoing pulse — same information, no motion.

---

## 9. Voice — Deepgram Integration (v2, not v1)

Push-to-talk button → browser `MediaRecorder` captures a short clip → uploaded as one blob to the backend on release → backend calls **Deepgram's pre-recorded transcription REST endpoint** (not the streaming/WebSocket API — simpler, and for short commands the latency difference is imperceptible; streaming is a v3 optimization if it's ever needed) → transcript returned to the client and handed to the command layer below. Unchanged by the §10 correction below — Deepgram is still exactly how the audio becomes text.

### Implementation (M7 — done)

**Scope, deliberately stopped short of §10:** this milestone builds capture → transcription → display, full stop. Nothing here calls `create_event`/`add_todo`/any action, nothing spawns a headless Claude Code invocation — §10's command layer is a separate, larger piece of work still blocked on its own open questions (a parallel research pass) and on setting up subscription-billed Claude Code auth, neither ready yet. The transcript is shown to the user (`Heard: "…"`) and nothing else — a real, honest result rather than a stubbed/faked command execution standing in for work that isn't built yet.

**Backend — `backend/src/lib/deepgram.ts`:** a thin wrapper around Deepgram's pre-recorded REST endpoint (`transcribeAudio(audio: Buffer, contentType: string, fetchImpl = fetch)`). Reads `DEEPGRAM_API_KEY` from env (`backend/.env.example`, same placement/pattern as `AUTH_PASSCODE`/`VAPID_*`) and throws a specific `DeepgramConfigError` if it's missing, rather than letting the request fail downstream with a confusing fetch error or an opaque Deepgram 401 — mirrors `lib/reminders.ts`'s `ensureVapid()` "fail clearly, don't crash the process" instinct, though unlike VAPID there's no no-op fallback here: transcription can't usefully degrade to silently doing nothing the way a background push scan can, so a misconfigured key is a clear `500`, not a silent skip. A non-2xx response from Deepgram itself throws `DeepgramApiError`, carrying only the HTTP status — deliberately never reading/logging Deepgram's own response body, so there's nothing upstream-specific to accidentally leak later. Both the target URL (`DEEPGRAM_API_URL`, defaults to the real endpoint) and the fetch implementation itself (`fetchImpl` parameter, defaults to the global `fetch`) are injectable — the actual substitution mechanism the e2e strategy below relies on, since there is no real `DEEPGRAM_API_KEY` available yet to test against.

**Backend — `backend/src/routes/voice.ts`:** `POST /api/voice/transcribe`, mounted in `index.ts` alongside the other routers, behind the same app-wide `requireAuth` gate (§5/§12) as everything else under `/api`. Takes the audio as one raw blob — `express.raw({ type: "*/*", limit: "15mb" })` scoped to just this route (not applied globally; no other route in this app takes a non-JSON body, and there's no multer/busboy dependency to add for a single blob per request). Translates `DeepgramConfigError` → `500` (`"Voice transcription isn't set up yet."`) and `DeepgramApiError` → `502` (`"Couldn't reach the transcription service. Please try again."`) — both fixed, generic client-facing strings; neither the key value nor Deepgram's own response body ever reaches the client or a log line. An empty transcript (Deepgram genuinely heard no speech) is returned as `{ transcript: "" }` with a normal `200` — a valid result per §9, not an error — and the frontend decides how to represent that. A genuinely empty/missing request body (not the same thing — no audio was even uploaded) is rejected with a `400` before ever calling Deepgram.

**Mock/test strategy for Deepgram (no real API key available yet):** `transcribeAudio`'s injectable `DEEPGRAM_API_URL` is the whole mechanism — the isolated e2e backend is configured with a fake key and pointed at `e2e/mock-deepgram-server.mjs` (plain `node:http`, no new dependency), which stands in for Deepgram's REST endpoint. That mock server's behavior is driven entirely by the uploaded bytes decoded as UTF-8 text (test "audio" clips are just plain text standing in for real audio, since it's a mock): a body of `"SILENT_CLIP"` returns an empty transcript, a body starting with `"TRIGGER_DEEPGRAM_ERROR"` returns a `500` with a deliberately raw-looking error body (so the test can assert the real backend sanitizes it rather than relaying it), and anything else is echoed back as the transcript — letting a test control exactly what a real round-trip produces without needing custom headers or any test-only branch in `deepgram.ts` itself. The "`DEEPGRAM_API_KEY` isn't configured" path is tested against a *second*, minimal backend instance (`playwright.config.ts`, port 4403) that deliberately has no key (and no `AUTH_PASSCODE`, so it's reachable directly) configured — a separate process rather than toggling the primary shared backend's env mid-suite, since e2e config is set once at process start. All three (primary backend, mock Deepgram server, unconfigured-backend instance) are isolated processes per this project's hard rule against touching the real backend/database; none of it is a real Deepgram account or real network egress. **Manual end-to-end verification against the real Deepgram API is still an open follow-up** once a real `DEEPGRAM_API_KEY` is available (the user is still fetching one) — the mock proves the integration's plumbing/error-handling is correct, not that the real API's response shape matches what `deepgram.ts` expects byte-for-byte.

**Frontend — press-and-hold, not tap-to-toggle:** `frontend/src/lib/useVoiceCapture.ts` (a hook, alongside `useMediaQuery`/`useAutoCollapse`/`useLiveSync` — this codebase's existing "hooks live in `lib/`" convention) exposes `start()`/`stop()`, wired to the mic button's `pointerdown`/`pointerup`/`pointercancel`. This wasn't an arbitrary pick between the two options: §9's own spec wording — "uploaded as one blob to the backend **on release**" — already settles it, and a walkie-talkie-style hold matches "push-to-talk" literally. It also can't be left accidentally recording if a tap is ever missed on a kitchen tablet, which matters more there than the minor cost of needing to keep a finger down for a few seconds. `useVoiceCapture` also absorbs a real race this choice introduces: the very first use shows the browser's own mic-permission dialog, which a user releases the button to interact with — `stop()` can land before `getUserMedia()` has resolved. A `pendingStopRef` remembers that request and applies it the instant recording actually starts, instead of leaving the mic recording indefinitely because the release had nowhere to land.

**Frontend — `frontend/src/components/VoiceButton.tsx` + `App.tsx` wiring:** structured after `NotificationPrompt.tsx`/its `App.tsx` wiring as the closest existing "small feature, own component, minimal App wiring" precedent, with one deliberate difference: `NotificationPrompt`'s open/dismiss state is lifted to `App.tsx` because other app state cares about it; nothing else in the app needs to know about voice capture state (§10, which would consume the transcript, is out of scope here), so `VoiceButton` owns its whole capture/upload/display state machine itself, and `App.tsx`'s only change is mounting `<VoiceButton />` in the header next to the existing bell-preview button. Shows `Heard: "…"` on success (an empty transcript shows `"Didn't catch that — try again."` instead, per §9's own instruction to represent that honestly rather than silently). Failure modes a non-technical user can actually hit are each a distinct, plain-language message rather than a raw error or a silent no-op: mic permission denied, no microphone found, no `MediaRecorder`/`getUserMedia` support on this browser, and an upload/network failure. These don't route through `lib/errors.ts`'s `friendlyErrorMessage` — that helper is built specifically around this app's zod `fieldErrors` validation-error shape (`JSON.stringify`-ing the server's `error` field, then unwrapping it), which would double-quote voice's plain-string server errors (`"Voice transcription isn't set up yet."` etc.) rather than display them cleanly. `lib/api.ts`'s `transcribeVoice` throws those messages directly instead, matching this app's general "clear, honest, non-technical message near what triggered it" convention without forcing voice's already-plain error strings through machinery built for a different response shape.

**Verification:** `e2e/voice.spec.ts` covers, against the isolated instances described above: a successful `POST /api/voice/transcribe` round-trip; a silent clip correctly returning `{ transcript: "" }` rather than an error; a genuinely empty request body rejected with `400`; a Deepgram-side error sanitized into a `502` with the mock server's raw body/error code asserted absent from the response; the unconfigured-key `500` path with the same absence assertions (no leaked env var name, no raw stack trace); and the real push-to-talk UI flow with the browser's `MediaRecorder`/`getUserMedia` mocked via `page.addInitScript` (`navigator.mediaDevices` is a getter-only property in real Chrome, so this uses `Object.defineProperty` rather than a bare assignment) — same spirit as `push-notifications.spec.ts` mocking `Notification`/`PushManager`, since no real microphone is reachable headlessly. The UI flow covers a full press-and-hold round-trip (a fake `MediaRecorder` emits known bytes on `stop()`, which the mock Deepgram server echoes back, so the test asserts the exact transcript shown), permission denied, unsupported browser, and an upload aborted via `page.route` to simulate a network failure. Full suite: confirmed green including this file, no regressions in the pre-existing 94.

**Not yet done, and can't be from here:** real end-to-end verification with an actual `DEEPGRAM_API_KEY` and a real device microphone — the mock server proves the backend's plumbing and error-sanitization are correct, not that Deepgram's real response shape matches `deepgram.ts`'s parsing byte-for-byte, or that real-world audio (background kitchen noise, a kid's voice, a real household accent) transcribes usefully. Do this once a real key is available: set `DEEPGRAM_API_KEY` in `backend/.env`, restart the backend, and hold the mic button for a real "add milk to the list"-style phrase on an actual device.

---

## 10. Command Layer (v2, not v1)

**Correction to earlier planning, recorded here because it changed the design materially:** the original plan called for a local Ollama model, on the reasoning that "runs locally on my PC" meant local *inference*. It didn't — it meant driving this through Claude Code (or an equivalent CLI backed by an existing Claude/ChatGPT subscription), running on this PC, the same way the `calendar-add` skill (§10a-1) already works. That's a materially different, more capable design, corrected here before M7/M8 are actually built against the wrong assumption.

```
transcript
     │
     ▼
headless Claude Code invocation, model=haiku
  claude -p "<transcript>" --model haiku --output-format json
  --allowedTools "mcp__our-calendar__list_events,mcp__our-calendar__create_event,..."
  CLAUDE_CODE_OAUTH_TOKEN set (subscription billing — see below, NOT
  ANTHROPIC_API_KEY, which is per-token API billing)
  (no --mcp-config needed — our-calendar is registered at User config
  scope, so every -p invocation auto-discovers it already; see below)
     │
     ├─ simple, unambiguous, no external facts needed
     │  ("add milk to the list," "move Gavin's dentist to Friday")
     │  → haiku calls the MCP tool directly. Fast, cheap — this is the
     │    common case and should feel close to instant.
     │
     └─ needs real-world facts haiku can't reliably know
        ("add all the Caps games in Tampa this season")
        → haiku spawns a sonnet subagent (Claude Code's Agent/Task tool,
          model override) scoped to research-and-report — same "never
          guess verifiable facts, cross-check sources" rule §10a-1's
          SKILL.md already encodes for calendar-add, not a second
          implementation of that judgment call
        → findings come back to haiku, which then calls the MCP tool(s)
          to actually create the events
```

- **Why headless Claude Code, not Ollama:** a small local model can competently map "add milk to the list" to `add_todo`, but has no real way to go fetch and cross-check a sports schedule — it would confidently hallucinate one instead of admitting it doesn't know, which is a worse failure mode than not having the capability, on a calendar real people trust. Routing through Claude Code (haiku by default, sonnet on demand) removes that gap entirely rather than working around it.
- **Billing:** `CLAUDE_CODE_OAUTH_TOKEN` (generated once via `claude setup-token`) is the documented mechanism for headless invocations billed against an existing Claude subscription rather than metered API usage. This is the whole point of the correction — don't lose the "on my subscription, not API" requirement by defaulting to `ANTHROPIC_API_KEY` (which Claude Code's `--bare` startup mode requires, and is real per-token billing) just because it's the more commonly-documented headless path.
- **Real trade-off, stated plainly, not glossed over:** this is not actually local/offline processing — voice transcripts leave the house and go to Anthropic's servers, same trust model as everything else this project already does through Claude Code, but a genuine departure from the original "everything stays on my PC" framing. Also needs network + a valid (periodically-refreshed) OAuth token sitting on this machine to work at all — a fully local model would degrade more gracefully through an internet or auth outage. Worth being conscious of both before this is built, not discovered after.
- **Both open prototyping questions confirmed empirically before building anything real** (raw `--output-format stream-json` event traces inspected, not just prose responses trusted at face value):
  - **The Agent/Task tool works inside headless `-p` mode.** A haiku `-p` invocation genuinely spawned a general-purpose subagent — confirmed via a distinct `task_started` event with its own `task_id`, a separate assistant message carrying its own `thinking` block tagged with `parent_tool_use_id`, and a `task_notification` result fed back to the parent. Not a hallucinated narrative — the subagent's real, independent computation (`17 * 23 = 391`) matched the parent's final reported answer.
  - **A spawned subagent does inherit the parent's MCP tools** — confirmed by the subagent itself issuing a `tool_use` for `mcp__our-calendar__list_people` and getting back real production data (the actual four household members), not fabricated output, identical whether the parent or the subagent made the call.
  - **Real gotcha this surfaced, not previously known:** headless mode's permission gate blocks *any* tool call by default — parent or subagent, MCP or otherwise — because there's no TTY to interactively approve one. The first attempt at both tests above failed with `permission_denied` until `--allowedTools "mcp__our-calendar__<tool-name>,..."` was passed explicitly. This is silent in the worst way: the call still returns `is_error:false` with a plausible-sounding prose explanation rather than an obvious hard failure — the real invocation needs to check the JSON output's `permission_denials` array explicitly, not just trust the prose `result` field, or a silently-refused command could look like a successful no-op to whatever's watching for the outcome.
  - **`--mcp-config` turned out to be unnecessary** — `our-calendar` is already registered at User config scope (`claude mcp get our-calendar` → "available in all your projects"), and every `-p` invocation auto-discovered it without the flag (confirmed via the init event's `mcp_servers` list on every run). `--mcp-config` is additive, not a requirement, for an already user-scoped server on this machine.
  - **Rough real latency observed** (not a formal benchmark): a simple single-turn haiku call, ~4s wall clock. Haiku spawning a subagent for a trivial task, ~9–14s. Haiku spawning a subagent that also makes an MCP call, ~16–20s. The research-escalation path is meaningfully slower than the fast path, as expected — worth setting UI expectations (e.g. a "researching..." state) around that gap rather than a single generic loading spinner.
- **Safety model: batch-tag-and-undo, not a confirm-before-execute dialog.** The original plan gated destructive/ambiguous actions behind a UI confirmation step. With the action layer's batch-tagging mechanism generalized out of `calendar-add` (§10a-1) so *every* caller can opt into it — voice included — cheap, precise undo ("undo that") is available for anything created this way, which fits the "tap mic, say it, done" experience much better than a confirmation popup breaking the flow for the common, low-risk case. Still worth deciding per-action-type whether some things (e.g. deleting an existing event outright, not creating one) warrant a confirm step anyway — that's a judgment call for when M8 is actually being built, not resolved here.
- Every voice command still gets logged (`voice_commands` table: transcript, which tier handled it — haiku-direct vs. haiku+sonnet-research — the resulting batch id if one was created, accepted/rejected) — useful for debugging misfires without adding real infra, and ties the audit trail to the same undo mechanism.

### Implementation (M8 — done)

**The design above got one real revision while building it**, on top of everything §10's prototyping already confirmed: rather than giving haiku the `Agent`/`Task` tool and letting it spawn a sonnet subagent *internally* (which the prototyping above genuinely proved works), the research escalation is orchestrated by this backend as a second, independent top-level `claude -p --model sonnet` invocation. Same effective behavior ("sonnet finishes the job"), but it means the tool allowlist for every invocation this endpoint ever runs is something `lib/voiceCommand.ts` states completely and explicitly, not something partially delegated to a nested spawn decision the model itself would make. This mattered enough to become the load-bearing security property of the whole feature — see the next paragraph.

**The one security decision that matters most here, restated as what's actually enforced in code:** `HAIKU_ALLOWED_TOOLS`/`SONNET_ALLOWED_TOOLS` (`backend/src/lib/voiceCommand.ts`) are the real enforcement point. Neither list contains `delete_event`/`update_event`/`delete_todo`/`update_todo`, and neither contains `Agent`/`Task` — every `claude -p` invocation this endpoint spawns is passed one of these two lists via `--allowedTools`, and headless mode's permission gate (§10's own confirmed finding) blocks anything not on it. An LLM that wants to delete or change an existing event/todo has no tool that can do it — it can only `list_events`/`list_todos`/`list_people` (all read-only) to identify the target, then set `proposedDestructiveAction` in its structured output (`lib/validation.ts`'s `voiceLlmOutputSchema`, extended with exactly this third branch beyond §10's original `{needs_research, action_taken}` prototype). A household member confirms it later via `POST /api/voice/confirm`, which executes it directly through the real `deleteEvent`/`updateEvent`/`deleteTodo`/`updateTodo` action-layer functions — **no LLM is ever involved in executing a confirmed destructive action.** Widening either allowlist should be treated as a security-review-worthy change going forward, not a routine edit — said directly in a comment at the top of `lib/voiceCommand.ts` so it isn't missed later.

**Structured output validated server-side, never trusted from the model's own internal consistency:** `voiceLlmOutputSchema` (`lib/validation.ts`) `.refine()`s that exactly one of `needsResearch`/`actionTaken`/`proposedDestructiveAction` is set — `--json-schema` only constrains *types*, not that rule, so this is enforced for real with zod, not assumed from the prompt asking for it nicely. Further than that: `lib/voiceCommand.ts`'s `resultToOutcome` doesn't even trust `actionTaken`'s own prose to mean "something was created" — it re-derives that from the real database via `getBatch(batchId)` (`actions/batches.ts`, §10a-2). If nothing is actually tagged with this command's batch id, the honest answer is `outcome: "no_action"`, never a claimed success the household couldn't actually undo.

**Reconciling "the LLM calls `create_event`/`add_todo` directly" with "everything one command creates needs the same batch id"** — the real puzzle this design had to solve, since an MCP tool call has no side channel for the caller to hand it a value: `runVoiceCommand` mints one `batchId` up front (`mintBatchId("voice")`) and sets it as `VOICE_COMMAND_BATCH_ID` on the *spawned `claude` process's own environment* (`lib/claudeCli.ts`'s `extraEnv`). Claude Code spawns `mcp/server.ts` (the same MCP server §10a already built) as a child process of that invocation, inheriting its environment the same way any child process inherits its parent's unless overridden — `mcp/server.ts` reads `VOICE_COMMAND_BATCH_ID` once at its own startup and passes it as `create_event`/`add_todo`'s existing (§10a-2) optional `batchId` parameter automatically, for every call made through that one server instance. The model never sees or sets a batch id itself, so there's nothing for it to get wrong or need to be told to echo back — and a human typing a request directly at `claude` (§10a's original interactive use case) is completely unaffected, since that env var is simply unset for them, same as before this existed.

Two alternatives were considered and rejected:
- **Backend re-executes the create itself** once the LLM reports what it did, calling `createEvent`/`addTodo` directly in-process with the trusted batch id. Rejected because it contradicts this feature's own stated design — the brief for this work is explicit that `create_event`/`add_todo` are the two tools an LLM *is* allowed to call directly (only delete/update are propose-only); re-executing every create server-side would make that direct-call design pointless.
- **Time-window correlation** (tag every row created after a watermark timestamp/id). Rejected because it's racy on a real shared household calendar — a family member creating something by hand in the UI during the few seconds to ~20s (§10's own observed research-path latency) a voice command is in flight could get wrongly swept into that command's batch, so "undo that" could delete someone else's unrelated entry. The env-var approach has no such window: only rows created *through this specific spawned process* ever see this batch id.

**Honest caveat, not yet verified for real:** this whole reconciliation depends on an environment-inheritance chain — this backend → the spawned `claude` process → Claude Code's own spawning of the `mcp/server.ts` child process — that has only been exercised against `e2e/mock-claude-cli.mjs` (which reads `VOICE_COMMAND_BATCH_ID` directly and writes the tagged row itself, standing in for what the real MCP server would do), never against a real `claude` binary with a real `CLAUDE_CODE_OAUTH_TOKEN`. The individual link this depends on (child processes inherit their parent's env by default) is standard, well-established Node/OS behavior, not a guess — but the full chain hasn't been watched happen for real. Confirm this once a real token exists: run a voice command that creates something, then check that row's `batch_id` column is actually set.

**`POST /api/voice/confirm` is stateless**, per the brief's own suggested design: the frontend echoes back the exact `proposedDestructiveAction` object a `needs_confirmation` response returned, and this route re-validates it (`proposedDestructiveActionSchema`, the same schema used to validate the LLM's own proposal) and executes it directly — no server-side "pending confirmation" record kept anywhere. This is deliberate, not just the path of least resistance: this is a single-household, already-`requireAuth`-gated app with no adversarial multi-tenant concern (§5), so there's no real actor stateful tracking would be defending against that re-validation doesn't already cover, and statelessness means there's no expiry/cleanup logic needed for a proposal a household member never acts on (they just never tap Confirm — nothing to garbage-collect).

**`voice_commands`** (`db/schema.ts`/`db/client.ts`, the first real implementation of §11's drafted-but-unbuilt schema) gets one row per `POST /api/voice/command` call: `transcript`, `modelTier` (`'haiku'` or `'haiku+sonnet-research'`), `parsedAction` (the validated structured output as JSON, or a failure detail string), `batchId` (only set when something was actually created — re-derived from `getBatch`, never trusted from the model), and `status` — mapped server-side from the outcome, not the model's self-report: `executed`/`needs_confirmation` → `'accepted'` (a valid, actionable triage), `no_action` → `'rejected'` (a valid triage that concluded nothing was warranted — not a failure), and only a genuinely failed invocation (denied tool, malformed output, timeout, ...) → `'error'`. `POST /api/voice/confirm` deliberately does **not** write its own `voice_commands` row — it's not itself an LLM-triaged command (no transcript, no model involved at all, by design), and the proposal it's executing was already logged when `POST /api/voice/command` first produced it.

**Response shape:** `{ outcome: "executed" | "needs_confirmation" | "no_action" | "error", modelTier, batchId?, summary?, proposedAction?, error? }` (`lib/voiceCommand.ts`'s `VoiceCommandResult`, mirrored in `frontend/src/types.ts`). `runVoiceCommand` never throws for a failure *inside* the LLM invocation — those all resolve to `{ outcome: "error" }` and are still logged, so the route only has one exception type left to handle specially: `ClaudeCliConfigError` (`CLAUDE_CODE_OAUTH_TOKEN` missing), translated into a `500` the same way `DeepgramConfigError` already is for §9's transcription endpoint — a deployment configuration problem, not a per-command outcome.

**`lib/claudeCli.ts`** is the generic "run one `claude -p` invocation forced into a JSON schema" wrapper `lib/voiceCommand.ts` builds on — it knows nothing about this app's specific prompts/schema/tools. `--print <prompt>` (the untrusted transcript) is always its own `spawn()` argv array element, never shell-concatenated, and `spawn()` is never called with `shell: true` — that distinction, not anything about validating the transcript's *contents*, is the real command-injection defense (`voiceCommandRequestSchema` only bounds length/non-emptiness, deliberately not characters — a real voice command will contain quotes, dashes, whatever a household member actually says). `cwd` is deliberately `os.tmpdir()`, not this repo's own checkout: `claude -p` auto-discovers `CLAUDE.md` files from its working directory, and this repo's own dev-tooling `CLAUDE.md` has nothing to do with triaging a household voice command — running from a neutral directory keeps that context out of the invocation entirely, without needing `--bare` (which would also stop `CLAUDE_CODE_OAUTH_TOKEN` from being read at all, since bare mode is documented as accepting only `ANTHROPIC_API_KEY`/`apiKeyHelper`). Checks `permission_denials` *before* `is_error` and before the exit code, per §10's own already-documented gotcha that a denied tool call still reports `is_error: false` with plausible-sounding prose.

**Testing — the mock, and a real dead end worth recording:** there is no real `CLAUDE_CODE_OAUTH_TOKEN` available (unchanged from §10's own note), so `runClaudeCommand`'s `spawnImpl` parameter is injectable exactly like `lib/deepgram.ts`'s `fetchImpl` (unit coverage: `lib/claudeCli.test.ts`, the first Vitest tests added since §10a-2's `batches.test.ts` — covers the `permission_denials`-before-`is_error` ordering, malformed/missing `structured_output`, non-zero exit, spawn failure, the timeout path, and that the prompt/`extraEnv` really do reach `spawn()` as discrete argv/env values). For e2e, the target `claude` invocation itself needed to be process-boundary-substitutable, the same role `DEEPGRAM_API_URL` plays for §9's Deepgram mock. **The first approach tried — prepending a directory containing a fake `claude.cmd` shim to the spawned child's `PATH` — was tested directly and confirmed unsafe**: on this Windows machine, `child_process.spawn()`'s executable resolution used the *real, ambient* `PATH` (and this machine's already-logged-in Claude Code credentials) rather than the overridden `env.PATH` handed to the child, and it silently invoked the real `claude` binary — an actual real invocation happened during this investigation, confirmed by a real, on-topic assistant response, not a mock string. Nothing sensitive was in the test prompt, but this is worth flagging plainly: **this machine has ambient Claude Code auth available outside of `CLAUDE_CODE_OAUTH_TOKEN`** (a file/keychain-based login, auth precedence's lowest-priority "Subscription OAuth credentials from `/login`"), so any code path that spawns bare `"claude"` without an explicit command override can succeed for real even when the env var this feature's own config-check looks for is unset. Two things follow from this, both already true of the shipped code: `ClaudeCliConfigError` is thrown from a plain `process.env.CLAUDE_CODE_OAUTH_TOKEN` check *before* `runClaudeCommand` ever calls `resolveCommand()`/`spawnImpl` at all, so the "not configured" path can never reach a real spawn regardless of what's ambiently available on the machine running it; and the e2e suite never relies on `PATH` — `e2e/mock-claude-cli.mjs` is wired in via two explicit env vars instead (`CLAUDE_CLI_COMMAND=<node>`, `CLAUDE_CLI_ARGS_PREFIX=<absolute path to the mock script>`, set only for the primary e2e backend in `playwright.config.ts`, using `process.execPath` rather than a bare `"node"` since that's not guaranteed to be on the child's `PATH` either), which `lib/claudeCli.ts` reads and uses directly rather than leaving to any ambient PATH search. The mock itself, driven by trigger substrings in the transcript (same pattern as `e2e/mock-deepgram-server.mjs`), writes directly into the isolated e2e SQLite file for its "created something" cases — including tagging the row with `VOICE_COMMAND_BATCH_ID` read from its own env, deliberately simulating exactly what `mcp/server.ts` would do, to prove the batch-id reconciliation mechanism end-to-end without needing the real MCP stdio transport (Anthropic's own tested mechanism, not this app's). `e2e/voice-command.spec.ts` covers: the direct-action fast path (with a real `POST /api/voice/undo` round trip), the needs-research escalation path, a proposed destructive action followed by a real `POST /api/voice/confirm`, a no-action triage, the invocation itself failing, an empty transcript rejected before ever invoking the model, the `CLAUDE_CODE_OAUTH_TOKEN`-missing path (against the same dedicated unconfigured backend instance §9's own Deepgram-missing test already uses), and that `voice_commands` gets exactly the row it should for every case above. Full suite: 111/111 passing (103 baseline + this work), including one pre-existing §9 UI test (`e2e/voice.spec.ts`) updated to assert on a real command outcome now that a heard transcript is acted on, not just displayed.

**Frontend (`frontend/src/lib/useVoiceCapture.ts`/`VoiceButton.tsx`, `lib/api.ts`):** a non-empty transcript now goes on to call `POST /api/voice/command` itself (a new `"commanding"` state, "Working on it…") instead of just being displayed — §9's original scope. The result toast shows what happened: an `executed` outcome shows its summary plus an **Undo** button (`POST /api/voice/undo` — §10a-2's own deferred "left for §10/M8" HTTP surface for `undoBatch`, built here since this is that caller); a `needs_confirmation` outcome shows the proposed action's summary with plain **Confirm**/**Cancel** buttons (Confirm calls `POST /api/voice/confirm`; Cancel just discards it client-side — nothing to tell the server, matching the stateless design above); `no_action`/`error` show their own plain message. No auto-listening or voice-driven confirmation here — deliberately out of scope for this pass, a named follow-up.

---

## 10a. MCP Server (M3 — explicitly earlier than voice/LLM, see roadmap)

Requested capability: drive the app from Claude Code / any MCP-capable CLI ("add milk to the list" typed at a terminal instead of tapped on a screen). Genuinely useful on its own, and not a scope detour from §10 — **it's the same action layer**, exposed a second way:

- §10's design already requires a validated, whitelisted set of actions (`add_todo`, `complete_todo`, `delete_todo`, `create_event`, `delete_event`, `move_event`, `list_events`, `list_todos`, …) with zod schemas, sitting behind the REST API. Building that as its own internal module (not scattered across Express route handlers) means it has exactly one home.
- The MCP server is a thin wrapper: each MCP tool definition calls straight into that same action module — no duplicate validation logic, no second implementation to keep in sync.
- §10's command layer (now that it's corrected to run through Claude Code rather than a local Ollama model — see §10) is this same MCP server's *third* caller, not a fourth implementation: the headless `claude -p` invocation is configured with `--mcp-config` pointing straight at this server, so a voice command and a typed Claude Code request end up calling the exact same tools. The `calendar-add` skill (§10a-1) is the fourth — same reasoning, different trigger.
- **Transport:** stdio, not HTTP/SSE — Claude Code runs on the same Windows PC as the backend, so a local stdio MCP server (registered once via `claude mcp add`) is the simplest correct choice. No auth/networking concerns because it never leaves the machine. Remote MCP access (e.g. from a laptop that isn't this PC) is a real but separate future step (would need HTTP transport + auth) — not needed for "ask Claude Code from the CLI" on this machine.

### Implementation (M3 — done)

**Action layer:** `backend/src/actions/` (`events.ts`, `todos.ts`, `people.ts`, `errors.ts`, `index.ts` barrel) — the one home described above. Each function (`listEvents`, `createEvent`, `updateEvent`, `deleteEvent`, `listTodos`, `addTodo`, `updateTodo`, `completeTodo`, `deleteTodo`, `listPeople`) validates its input with the same zod schemas `lib/validation.ts` already had (`createEventSchema`/`updateEventSchema`/`createTodoSchema`/`updateTodoSchema` — none duplicated), throwing `ActionValidationError` (carries the same `.flatten()` shape the old inline `safeParse` calls returned) or `ActionNotFoundError` rather than touching `res` directly, so the functions are transport-agnostic. `listEvents` reuses `lib/recurrence.ts`'s read-time RRULE expansion unchanged (§7a). Every mutating action calls `broadcast()` (`lib/sse.ts`) itself, so a todo added over MCP live-syncs to every connected browser tab exactly like one added through the UI — not something each caller has to remember to do. `completeTodo` is a small convenience wrapper over the generic `updateTodo` (`{ completed: true }`), added because it made a cleaner standalone MCP tool than requiring the generic partial-update shape for the common "check this off" case.

`routes/events.ts`, `routes/todos.ts`, `routes/people.ts` were refactored to call into these functions and translate the two error types into the same `400`/`404` JSON shapes they already returned — response bodies, status codes, and SSE broadcast timing are unchanged (verified by the full `e2e/` suite passing 54/54 post-refactor, same count as §14/M2).

**MCP server:** `backend/src/mcp/server.ts`, built on the official `@modelcontextprotocol/sdk` (added to `backend/package.json`). Uses the high-level `McpServer`/`registerTool` API with `StdioServerTransport`. Ten tools, one per action above (`list_events`, `create_event`, `update_event`, `delete_event`, `list_todos`, `add_todo`, `complete_todo`, `update_todo`, `delete_todo`, `list_people`) — each tool's `inputSchema` *is* the corresponding zod schema from `lib/validation.ts` (extended with an `id` field for the row-targeted ones via `.extend()`, not redefined), so the MCP tool's argument validation, the REST body validation, and any future §10 LLM-executor validation all come from the same schema object. It imports `db`/`sqlite` from the existing `db/client.ts` — same file, same `DB_DIR_NAME` override — so it opens a second connection to the *same* SQLite file the running backend uses (WAL mode already handles concurrent local connections, per §3); it does not seed or duplicate schema-init logic. Action errors are caught once (`runAction` helper) and returned as an MCP `isError: true` tool result rather than an uncaught exception, so a bad Claude Code tool call surfaces a readable message instead of a crashed connection.

**Registering it:** build the backend once (`cd backend && npm run build`), then register the built entry point with Claude Code:

```
claude mcp add our-calendar -s user -- "C:\Program Files\nodejs\node.exe" "C:\Users\ericm\projects\our-calendar\backend\dist\mcp\server.js"
```

Registered and verified working (`claude mcp list` → `our-calendar ... ✔ Connected`) as part of M3. Two things worth knowing if this ever needs re-registering:
- **Use `node.exe`'s full path, not bare `node`.** Claude Code spawns MCP servers via `cmd.exe`, which on this machine doesn't have Node's install directory (`C:\Program Files\nodejs`) on `PATH` — a bare `node` command fails with `'node' is not recognized...` and Claude reports a generic `Connection closed` rather than that underlying reason (visible with `claude --debug-file <path> mcp list`, which is how this got diagnosed). The absolute path sidesteps the missing-`PATH` issue entirely.
- `-s user` makes it available from any directory on this machine (not just when `cd`'d into this repo) — matches the "add milk to the list from a terminal" use case, which isn't repo-scoped.

It talks to whatever `backend/data/our-calendar.sqlite` currently holds (the real household DB, same file `npm run dev`'s backend uses), so it needs rebuilding (`npm run build`) after any `actions/` or `mcp/` change for the registered server to pick it up — there's no watch mode for the registered process. For iterating on the MCP server itself without rebuilding each time, run it directly instead: `npm run mcp` (`tsx src/mcp/server.ts`, from `backend/`).

Verify it's registered/healthy with `claude mcp list`; inspect one server with `claude mcp get our-calendar`; remove with `claude mcp remove our-calendar -s user`.

---

## 10a-1. `calendar-add` Skill — safe batch creation from a directive (built directly, ahead of §10/M7-M8)

Direct request, after watching how much research a single real ask ("add all the Buffalo Bills games this season") actually needed: a Claude Code skill that takes a directive, does its best to fulfill it — researching real facts from live sources rather than guessing when the directive references something verifiable — and creates the resulting events through the same action layer §10a already established as the one true entry point. Built ahead of §10 (voice) for the same reason the MCP server was built ahead of §10: it's a real, working preview of the same "directive → researched → action-layer calls" shape §10's command layer needs, de-risking that design before it's built against assumptions instead of evidence — see §10's own correction note for exactly what that evidence changed.

**The actual point of this skill isn't the research step, it's the safety net.** "Do its best" implies it can get a directive wrong — misread scope, wrong assumption about which household member, a source that turns out stale. The answer isn't a confirm-before-execute dialog (there's no UI surface for a CLI-triggered skill to put one in) — it's making every batch **precisely, cheaply undoable after the fact**:

- Every event created in one invocation shares a batch id, appended as a `[calendar-add:<batch-id>]` tag on each event's `description`.
- A manifest recording the *exact* created event ids (not a title/date pattern to re-derive later) is written to `.claude/skills/calendar-add/runs/<batch-id>.json`.
- Undoing calls `deleteEvent` on precisely those ids and archives the manifest (`.undone.json`, kept — not deleted, an audit trail of what was added and later reverted) — never a fuzzy re-match against what's currently in the calendar, which could easily catch something the household added separately around the same time.

This tag-and-manifest mechanism is written generally enough that it isn't actually skill-specific — see §10's note on generalizing it into the action layer itself so voice-created events (and any future caller) get the same cheap, precise undo, not a second implementation of the same idea.

**Implementation:** `.claude/skills/calendar-add/` — `SKILL.md` (the instructions an invocation follows: research-before-guessing rule, ambiguity defaults, workflow), `add-events.mjs` (takes a batch label + a JSON file of events matching `createEventSchema`, calls `createEvent` per event via the same import path the MCP server's design established as safe — direct local module import of `backend/dist/actions/events.js`, not a network call), `undo-events.mjs` (takes a batch id or `latest`, reverses exactly that batch). `runs/` is gitignored — it's real per-household data about what was added when, not something to version-control alongside the skill's code.

**First real use:** the Bills' 2026 regular season schedule (16 games — the 18th week's date is officially TBD per NFL convention as of this writing, correctly skipped rather than guessed). Cross-checked against ESPN and the Bills' own site, which agreed exactly, before creating anything — exactly the standard the skill's own instructions require of any invocation.

---

## 10a-2. Batch-tag-and-undo, generalized into the action layer (ahead of §10/M8)

`calendar-add`'s tag-and-manifest mechanism (§10a-1) worked, but it was built as a standalone script's own private convention — a description string tag plus a JSON manifest file on disk. §10's design (the "safety model" bullet) already commits to reusing this same idea for the voice command layer, so it needed to exist as a real, shared action-layer primitive before M8 could be built against it, the same reasoning that pulled the MCP server (§10a) forward ahead of voice.

**What changed from calendar-add's original approach, and why:**

- **A real `batch_id` column** (nullable, indexed) on both `events` and `todos` — not a tag embedded in `description`/`notes` that has to be regex/string-matched back out to find "everything in this batch." `undoBatch(batchId)` (`backend/src/actions/batches.ts`) just selects `WHERE batch_id = ?` against the tables that are already the source of truth. This also means a batch can span both tables in one id (a future "add the game to the calendar and put tickets on the to-do list" voice command doesn't need two separate undo mechanisms), which calendar-add's events-only manifest never had to handle.
- **No separate manifest file.** calendar-add's `runs/<batch-id>.json` exists because a standalone script has nowhere else durable to record "which ids did I just create" — but inside the action layer, the row *is* that record; a second file that could drift from the database (e.g. if a row is later hand-edited or the process crashes mid-batch) is a liability, not a feature, once there's a real column to query instead.
- **The human-readable trace is kept, but demoted to cosmetic.** calendar-add's `[calendar-add:<id>]` description tag genuinely earned its keep — it's the only way a household member looking at an event today can tell "why is this here." `createEvent`/`addTodo` still append an equivalent `[batch:<id>]` trace (`lib/batchTag.ts`'s `appendBatchTag`, to `description`/`notes` respectively) whenever a `batchId` is passed, so that value isn't lost. The difference: `undoBatch` never reads this string back — it's purely for a human glancing at the row, not part of how undo finds anything. This is the opposite dependency direction from calendar-add's original design, and it's what makes undo robust against someone hand-editing an event's description later (that no longer breaks undo the way stripping/mangling the old tag would have against a string-match approach).

**Where it lives:** `backend/src/actions/batches.ts` — `mintBatchId(label?)` (a `crypto.randomUUID()`, optionally slug-prefixed with a caller-given label for readability in logs/traces) and `undoBatch(batchId)`. `createEvent`/`addTodo` (`actions/events.ts`/`actions/todos.ts`) both gained an **optional second `batchId` parameter** — deliberately not a field on the existing zod input schemas (`createEventSchema`/`createTodoSchema`), since those schemas double as the REST request-body validator and an HTTP caller should never be able to set its own `batch_id` directly. `routes/events.ts`/`routes/todos.ts` still call `createEvent(req.body)`/`addTodo(req.body)` exactly as before (one argument) — ordinary household-created events/todos are completely unaffected; `batch_id` is only ever set by a trusted in-process caller that minted one itself. `undoBatch` deletes via the real `deleteEvent`/`deleteTodo` actions, one row at a time — never a raw `DELETE ... WHERE batch_id = ?` — specifically so every side effect those two functions already own (the `broadcast("events:changed")`/`broadcast("todos:changed")` SSE calls that keep every other connected device live-synced, §3; `sent_reminders`' `ON DELETE CASCADE`, §11) fires exactly the same way a manual delete would, and automatically keeps firing correctly if those functions ever grow another side effect later — undo doesn't need a matching update to stay correct. Undoing an unknown or already-undone batch id is a graceful no-op (`{ deletedEvents: 0, deletedTodos: 0 }`), not a thrown error — a caller (voice, a retried request, a household member saying "undo" twice) can't always know in advance whether an id is still active.

**`calendar-add` itself was deliberately left alone**, not migrated to call this. It already works, is already tested (real production use — see §10a-1's "First real use"), and migrating it buys consistency, not correctness — its manifest-file approach isn't broken, it's just no longer how a *new* caller should be built. Revisiting that migration later (once the voice layer has exercised this primitive for real) is a reasonable future cleanup, but not before then; there's no value in touching working, tested code purely for symmetry ahead of an actual need.

**Not built here at the time — since built in §10/M8:** any REST route or MCP tool exposing `mintBatchId`/`undoBatch` to an outside caller. This pass was intentionally action-layer-only, matching how the MCP server (§10a) itself was built one layer beneath its eventual callers first. §10's M8 Implementation is where that caller landed: `POST /api/voice/command` mints one batch id per accepted voice command up front, threads it through every `createEvent`/`addTodo` call that command makes (via `VOICE_COMMAND_BATCH_ID` — see that section for exactly how, since an MCP tool call turned out to have no side channel for a caller to hand it a value directly), and records it on the corresponding `voice_commands.batch_id` row (§11); `POST /api/voice/undo` is the actual HTTP surface for `undoBatch` this note anticipated. `getBatch(batchId)` (also in `actions/batches.ts`) is what `lib/voiceCommand.ts` uses to answer "did this command actually create anything" — the same shape this note predicted would be needed for a confirmation UI, ended up used instead to make the *outcome itself* honest rather than trusted from the model's own self-report (see §10's Implementation).

**Testing:** `backend/vitest.config.ts` + `backend/src/actions/batches.test.ts` — the first Vitest unit tests in this repo (§13 had called for Vitest "for the things that are actually easy to get subtly wrong," but nothing had actually installed it before now). Unit-level, not Playwright e2e, because `batchId`/`undoBatch` have no HTTP surface yet for a browser-driven e2e test to reach through (that's exactly what's deferred to M8, above) — the same reason `e2e/db.ts` already reads `push_subscriptions`/`sent_reminders` straight out of the isolated SQLite file rather than through a route that deliberately doesn't exist (§8a/§12). Isolated via its own throwaway `DB_DIR_NAME` (a fresh `data-vitest-<uuid>` directory per run, cleaned up in `afterAll`) — never `data/` (real) or `data-e2e/` (Playwright's). Covers: `createEvent`/`addTodo` storing `batch_id` and appending the `[batch:<id>]` trace; ordinary single-argument calls (how every existing REST route already calls these) staying completely unaffected; `undoBatch` removing exactly one batch's rows across both tables and leaving a second batch and untagged rows untouched; undoing a nonexistent batch id and undoing the same batch twice both being graceful no-ops; and — using the real `lib/sse.ts` with a fake client `Response` capturing writes, not a mock — that `undoBatch` fires one real `events:changed`/`todos:changed` broadcast per deleted row, proving it goes through `deleteEvent`/`deleteTodo` rather than bypassing them. The browser-side half of that same broadcast guarantee (a live tab actually refetching on signal) is already covered for `deleteEvent`/`deleteTodo` by the existing `e2e/live-sync.spec.ts`, which this reuses rather than duplicates.

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
  batch_id      TEXT,                       -- nullable, indexed; §10a-2's batch-tag-and-undo primitive
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
  batch_id           TEXT,            -- nullable, indexed; §10a-2's batch-tag-and-undo primitive
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
--
-- ON DELETE CASCADE: real bug, found via direct report — "can't delete
-- events from the past, but future ones work". Root cause: this FK
-- originally had no ON DELETE CASCADE, so deleting an event that already
-- had a reminder sent for it (i.e. anything already past/notified) failed
-- with a foreign-key-constraint error, since the delete would've left its
-- sent_reminders row pointing at a nonexistent event. Fixed here (fresh
-- installs) and via client.ts's ensureCascadeDelete migration (existing
-- databases — SQLite has no ALTER TABLE ... ALTER CONSTRAINT, so it
-- rebuilds the table: create a correctly-constrained replacement, copy
-- every row over unchanged, drop the old one, rename the new one into
-- place). Regression test: e2e/push-notifications.spec.ts's "an event that
-- has already had a reminder sent for it can still be deleted".
CREATE TABLE sent_reminders (
  event_id           INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  occurrence_start_at TEXT NOT NULL,   -- ISO 8601; same value for non-recurring events
  sent_at            TEXT NOT NULL,
  PRIMARY KEY (event_id, occurrence_start_at)
);

-- v2 (§10) -- built for real in M8 (see §10's own "Implementation"
-- subsection). model_tier/batch_id were added when §10's Ollama->Claude
-- Code correction landed: which model actually handled the command, and
-- the batch id (§10a-2's real batch_id column mechanism, generalized out
-- of calendar-add, §10a-1) if this command created anything, so a logged
-- command and its undo trail are the same lookup, not two -- undoing a
-- voice command means calling undoBatch(voice_commands.batch_id).
CREATE TABLE voice_commands (
  id             INTEGER PRIMARY KEY,
  transcript     TEXT NOT NULL,
  model_tier     TEXT NOT NULL,    -- 'haiku' | 'haiku+sonnet-research'
  parsed_action  TEXT,             -- JSON
  batch_id       TEXT,             -- NULL if nothing was created
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

v2 adds `POST /api/voice/transcribe` (Deepgram, §9) and, per §10's M8 Implementation: `POST /api/voice/command` (spawns the headless Claude Code invocation described in §10, returns a `VoiceCommandResult`), `POST /api/voice/confirm` (executes a previously-proposed destructive action — stateless, no LLM involved, see §10's Implementation), and `POST /api/voice/undo` (§10a-2's `undoBatch`, exposed over HTTP for the first time here). Neither the MCP server (§10a) nor `calendar-add` (§10a-1) add HTTP routes — both call the same underlying action module the REST handlers above call, over stdio/direct import instead of HTTP; §10's command layer is a third caller of that same module via MCP, not a parallel implementation.

---

## 13. Logging, Testing, Backups

**Logging:** structured JSON logs via `pino`, writing to a rotating local file (`pino/pino-roll`) plus console. No centralized log stack — total overkill for two users; if something breaks, you'll be reading the file directly.

**Testing:** pragmatic, not exhaustive. Unit tests (Vitest) for the things that are actually easy to get subtly wrong: RRULE expansion (§7a), the LLM/MCP tool-call zod validator, todo/event CRUD.

**E2E (Playwright):** colocated in this repo (`e2e/`, `playwright.config.ts`) — not split into a separate repository. Test code is tightly coupled to this app's actual selectors/flows/API shape and needs to change in the same commit as whatever it's testing; splitting it out would risk tests silently drifting out of sync with the app they're supposed to verify, for no benefit at this scale (nothing else shares this test suite). Runs isolated from the live dev database — see the `qa-validator` agent role below.

**Independent QA validation:** a separate agent role (`qa-validator`, defined globally at `~/.claude/agents/qa-validator.md` — deliberately global, not project-local, since the *methodology* — isolation practice, adversarial testing, reporting format — is reusable across projects even though the actual test code it writes is not) builds and runs this suite against an isolated instance of the app (different ports, a fresh gitignored SQLite file via a git worktree — never the live dev database, which holds real household data). It only tests and reports; it never fixes application code itself, keeping verification independent of whichever agent built the feature.

**Backups:** since §7's reversal, **all real household data lives only in this one SQLite file** — there's no Google-side copy acting as a fallback anymore, which makes this the single most important durability mechanism in the whole system, not a nice-to-have. A manual snapshot (`better-sqlite3`'s `.backup()`, a consistent-copy API) was already taken by hand once real events existed, into `backups/` (gitignored, outside the tracked repo). M2 formalizes this into a small scheduled script — same mechanism, run automatically — copying into a synced folder (e.g. Google Drive, since the account already exists) daily, keeping ~2 weeks of rotation. No separate backup service needed.

---

## 14. Roadmap

Each milestone is independently useful/testable — nothing requires the full architecture to exist before something works.

- **M0 — Skeleton. ✅ Done.** Vite+React scaffold, Express scaffold, one page rendering in a browser, wired end-to-end.
- **M1 — Month calendar UI. ✅ Done.** Real month grid, tap-a-day interaction, day-detail view with empty state, responsive tablet/iPhone layouts, Paper & Ink skin as real CSS tokens, add-event/add-todo flows, per-person color coding (`people` table, 4 hardcoded members) with deduplicated month-grid dots — backed by real local SQLite CRUD (events, todos), no Google (dropped entirely, see §7).
- **M2 — In progress. Live sync, and the feedback from the first real household usage:**
  - **SSE live-sync for events, todos, and settings — ✅ done.** `backend/src/lib/sse.ts` + `GET /api/stream` broadcast `events:changed`/`todos:changed`; frontend's `useLiveSync` hook invalidates the matching query cache on signal. This is what fixes "I had to manually refresh to see what she added."
  - **Recurring events (§7a) — ✅ done.** `recurrence_rule` column, read-time RRULE expansion (via the `rrule` package) in `GET /api/events`, master row only, no materialized occurrences. Edit/delete affect the whole series, per §7a's explicit v1 scope limit. The Repeats picker now round-trips real state (editing a recurring event shows its actual pattern, not a reset).
  - **Todo due dates (§8) — ✅ done**, including **overdue sort-to-top** (incomplete + past-due items float to the top, most-overdue-first, nothing else automatic). **Hide-completed toggle — ✅ done** (client-side filter, unchanged from earlier scope).
  - **Imminent-event pulse (§8b)** — still queued, not yet built. Was deliberately held back from the batch above since it touches the same month-grid/day-detail components; builds next, now that batch has landed and stopped moving.
  - **Delete affordance — ✅ fixed.** Was genuinely broken, not just hard to notice: opacity-0-until-`:hover` is unreachable on a touchscreen entirely. Now an always-visible touch target on both events and todos.
  - **Event editing — ✅ done.** Tap an event row to edit it via the same add-event sheet, pre-filled, wired to the `PATCH /api/events/:id` endpoint that already existed from M1's CRUD build.
  - **All 3 known validation/error-handling bugs — ✅ fixed**, found by the independent QA validator (`qa-validator`, global agent role — see §13) via the now-colocated `e2e/` Playwright suite (54/54 passing, independently re-verified against real household data untouched):
    1. Blank event titles are now rejected client-side, not silently saved as "Untitled event."
    2. ~~An event title over the backend's 200-char limit is correctly rejected server-side, but the failure is silent~~ — mutation failures now surface a visible inline error.
    3. ~~Same silent-failure pattern for todo text over the 500-char limit~~ — same fix, same mechanism.
    **UX decision made during implementation, worth confirming rather than silently accepting:** on a rejected save, the add/edit sheet now **stays open with an inline error banner** rather than the originally-sketched "close + toast" — lets you immediately fix the input without re-opening the form. Reasonable default; flagging since it wasn't explicitly specified beforehand.
  - **Backup script formalized (§13) — ✅ done.** `backend/scripts/backup.mjs`, `npm run backup`, `.backup()`-based consistent snapshot into `backups/`, 14-day rotation. OS-level scheduling (Windows Task Scheduler) documented as a manual step in the script's own header, not automated.
  - **Known edge case, not addressed (v1 scope, not a bug):** editing a recurring event's date/time currently re-anchors the whole series' start to whatever date was open at edit time. There's no per-occurrence UI in v1 to expose or avoid this — a natural (if slightly surprising) reading of "editing affects the whole series" (§7a). Worth a UX pass later if it causes real confusion, not urgent now.
  - **Formalize the backup script** (§13) — an ad-hoc snapshot was already taken by hand once real household data existed; turn that into the real scheduled script now rather than waiting for M5, since §7's reversed decision makes SQLite the only durability story.
  - Settings → Appearance page (already-planned skin picker, unchanged from earlier scope).
  - **Process for this milestone specifically:** the UX agent mocks up the new interactive pieces (recurrence picker, hide-completed toggle, due-date entry/display) directly in the real frontend using local/mock state — no schema or backend changes — for approval *before* any of the underlying infra (SSE-for-events, recurrence expansion, due-date persistence) gets built. Delete-affordance and backup-script work aren't UI-facing in the same way and don't need to wait on that approval.
- **M3 — MCP server. ✅ Done** (§10a). `backend/src/actions/` extracted as the shared, zod-validated action layer; `routes/events.ts`/`todos.ts`/`people.ts` refactored to call into it (response shapes/status codes/SSE timing unchanged, 54/54 e2e still passing); `backend/src/mcp/server.ts` exposes the same actions as a local stdio MCP tool set via `@modelcontextprotocol/sdk`, registered with `claude mcp add` (see §10a's "Implementation" subsection for the exact command). Explicitly pulled forward ahead of voice/LLM (below) because it forces that action layer to exist as a clean, reusable module now, which directly speeds up M7 later.
- **M4 — PWA + tablet kiosk.** PWA: automatable parts done. Tablet kiosk: done, on a different plan than originally scoped — see below. Manifest (`manifest.json`) + icon set (192/512/maskable/apple-touch) + service worker via `vite-plugin-pwa`, app-shell-only caching (deliberately no `/api` runtime caching — see §4's "PWA implementation" subsection for the full writeup and why this must stay that way), installability verified programmatically (valid manifest, registered service worker, localhost as secure origin) and covered by `e2e/pwa.spec.ts`. `viewport-fit=cover` is set on the viewport `<meta>` (`index.html`) for safe-area/notch handling — this opts the page into drawing under the iPhone notch/home-indicator, which in turn means the edge-to-edge fixed elements needed explicit `env(safe-area-inset-*)` padding added: the app's root container (top/left/right), the mobile day-detail bottom sheet, the add-event bottom sheet, and the mobile notification-prompt toast (all bottom-edge elements, plus top/sides on the root) — see the affected files' inline comments for specifics. **Tablet kiosk plan changed:** the originally-planned Fully Kiosk Browser setup was abandoned — its screensaver/idle-dim and motion/touch wake scheduling are Plus-license (paid) features, and the direct instruction was "I don't want to pay anything." Replaced with a free, custom root-based kiosk setup (the tablet is already rooted via Magisk) — ✅ done and tested for real on the device; see §4b. What's *not* done, and can't be confirmed from here: the real "Add to Home Screen" test on an actual iPhone — status unclear/unconfirmed, not asserted done; see §4's manual checklist.
- **M5 — Push notifications. ✅ Done** (§8a — see its "Implementation (M5 — done)" subsection for the full writeup). Requested directly by Lindsay; placed here specifically because it has a hard dependency on M4's service worker/installed-PWA context — VAPID keypair + `push_subscriptions`/`sent_reminders` tables (§11) + `POST`/`DELETE /api/push/subscribe` actions/routes (§12) + the in-process `setInterval` reminder scan (reusing §7a's recurrence expansion, not reimplementing it) + `NotificationPrompt.tsx` wired for real (UI shell unchanged) + the service worker switched from `generateSW` to `injectManifest` (§4) so it can carry real `push`/`notificationclick` handlers, app-shell-only caching preserved and re-verified. Fixed 30-minute lead time and fixed message template, deliberately not configurable, per §8a. `e2e/push-notifications.spec.ts` covers subscribe/unsubscribe persistence and the reminder-scan/dedup logic against an isolated backend; real device delivery needs the manual checklist at the end of §8a's implementation subsection once actually deployed (M6). 89/89 e2e passing, no regressions.
- **M6 — Auth + remote access.** Device-session passcode flow, Caddy + DuckDNS port setup (networking specifics already confirmed in §6), router forwarding, PM2 process management. (Not a hard dependency for M5's push delivery itself — subscriptions send independent of remote reachability — but this is what makes subscribing/using the app reliable while away from home, so the two naturally land around the same time.)

**→ v1 complete here — daily-usable without anything below.**

- **`calendar-add` skill. ✅ Done** (§10a-1), between M5 and M6. Direct request, prompted by a real "add all the Buffalo Bills games this season" ask that needed live research to fulfill correctly. `.claude/skills/calendar-add/` — researches verifiable facts from live sources rather than guessing, creates events through the same action layer as everything else, tags/manifests every batch for precise undo. Also functioned as a real, working preview of §10's "directive → researched → action-layer calls" shape, which directly fed the §10 correction below.
- **M7 (v2) — Voice input. ✅ Done** (§9 — see its "Implementation (M7 — done)" subsection for the full writeup). Mic button, `MediaRecorder` capture, Deepgram transcription endpoint — press-and-hold, `POST /api/voice/transcribe`, transcript displayed as `Heard: "…"`. Deliberately stops there: nothing from M8 (below) is built or stubbed. Verified against isolated instances only — no real `DEEPGRAM_API_KEY` is available yet, so real-device/real-API verification is a follow-up once one is provided. Unaffected by M8's correction below — still exactly this.
- **Batch-tag-and-undo, generalized into the action layer. ✅ Done** (§10a-2), between M7 and M8. `backend/src/actions/batches.ts`'s `mintBatchId`/`undoBatch`, a real indexed `batch_id` column on `events`/`todos` (replacing calendar-add's description-tag-plus-manifest-file approach as the *undo* mechanism, though the human-readable trace is kept for the same provenance value), and an optional `batchId` param threaded through `createEvent`/`addTodo`. Built ahead of M8 for the same reason the MCP server (§10a) was built ahead of voice: M8 needs this primitive to already exist, not to build it inline while also building the voice endpoint. `calendar-add` itself is untouched — still its own tested, working file-manifest mechanism; migrating it wasn't worth the risk for a purely cosmetic consistency win. First Vitest unit tests in this repo (`backend/src/actions/batches.test.ts`), since this primitive has no HTTP surface yet for Playwright to reach through.
- **M8 (v2) — Command layer. ✅ Done** (§10 — see its "Implementation (M8 — done)" subsection for the full writeup). *Corrected from the original plan* (see §10's own note) — not Ollama; headless Claude Code invocations (`claude -p`, `CLAUDE_CODE_OAUTH_TOKEN` for subscription billing, M3's MCP server auto-discovered — no `--mcp-config` needed) with haiku as the fast default and, when it flags real-world research is needed, a second, independent top-level sonnet invocation (not an internal Agent/Task subagent — a deliberate change from the design as originally sketched, made so every invocation's tool allowlist stays something the backend states explicitly rather than partially delegating it to a nested spawn). `POST /api/voice/command` (triage + create/propose), `POST /api/voice/confirm` (stateless — executes a previously-proposed destructive action directly, no LLM involved), `POST /api/voice/undo` (§10a-2's `undoBatch`'s first HTTP surface). Undo via the batch-tag mechanism generalized out of `calendar-add` (§10a-2, done ahead of this milestone): one batch id minted per command, threaded to the spawned process's own env (`VOICE_COMMAND_BATCH_ID`) so `mcp/server.ts` tags every row it creates automatically — no confirm-before-execute dialog for creates, only for destructive proposals. Both open questions §10's own prototyping originally flagged were confirmed empirically before this was built (real subagent execution, real MCP inheritance) — the one real gotcha that testing surfaced (headless mode needs an explicit `--allowedTools` list; a denied call fails silently with `is_error:false` unless `permission_denials` is checked explicitly) is what `lib/claudeCli.ts` checks first, ahead of `is_error` and the exit code.
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
