/// <reference lib="webworker" />
// frontend/src/sw.ts — hand-written service-worker source, built via
// vite-plugin-pwa's `injectManifest` strategy (see vite.config.ts).
//
// Why injectManifest, not generateSW (the M4 default, switched this pass
// for M5 — ARCHITECTURE.md §4/§8a): real Web Push needs a `push` listener
// and a `notificationclick` listener on the service worker itself.
// generateSW only lets you *configure* the Workbox service worker it
// auto-generates (precache list, runtime-caching rules) — there's no hook
// to add arbitrary custom event listeners to that generated file. With
// injectManifest, we own this source file outright, and vite-plugin-pwa's
// only job is to inject the precache manifest (`self.__WB_MANIFEST` below)
// into it at build time.
//
// This file is deliberately excluded from tsconfig.app.json's type-checked
// set (see that file's `exclude`) — it needs the `webworker` lib (the
// triple-slash reference above), not `dom`, and mixing the two in one TS
// project isn't supported. Vite/esbuild still transpiles and bundles it
// normally either way; only its own type-checking is opted out.
//
// **App-shell-only caching contract, preserved exactly (§4):**
// `precacheAndRoute()` below only ever precaches the built JS/CSS/HTML/
// icons/manifest listed in the injected manifest — there is deliberately
// no `registerRoute()` / runtime-caching call anywhere in this file, so
// `/api/*` is never intercepted or cached by this service worker, same as
// the old generateSW config's "no runtimeCaching entries" rule. Do not add
// one without re-reading §4's "Caching contract" paragraph first.
import { precacheAndRoute } from "workbox-precaching";

declare let self: ServiceWorkerGlobalScope;

// `self.__WB_MANIFEST` is the injection point vite-plugin-pwa replaces with
// the real precache manifest at build time (workbox-precaching's own types
// augment `ServiceWorkerGlobalScope` with this property — see
// node_modules/workbox-precaching/PrecacheController.d.ts).
precacheAndRoute(self.__WB_MANIFEST);

// Take control immediately rather than waiting for every open tab of an
// old service worker to close — matches the M4 config's
// `registerType: 'autoUpdate'` behavior this replaces (vite.config.ts), so
// this is a like-for-like swap, not a new update-prompt UX to build.
self.skipWaiting();
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// ARCHITECTURE.md §8a — the real reason for this whole strategy switch.
//
// The backend (`backend/src/lib/reminders.ts`) sends a JSON payload shaped
// `{ title, body, eventId, occurrenceStartAt }`, where `body` is already
// the fixed `"{title} — {time} ({person})"` template (§8a), computed
// server-side so every subscribed device shows byte-identical text. This
// handler's only job is handing that straight to the OS notification tray.
self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload: { title?: string; body?: string; eventId?: number; occurrenceStartAt?: string };
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "Our Calendar", body: event.data.text() };
  }

  event.waitUntil(
    self.registration.showNotification(payload.title ?? "Our Calendar", {
      body: payload.body ?? "",
      icon: "/icons/pwa-192x192.png",
      badge: "/icons/pwa-192x192.png",
      data: { eventId: payload.eventId, occurrenceStartAt: payload.occurrenceStartAt },
    }),
  );
});

// Tapping the notification focuses an already-open tab if there is one,
// otherwise opens a new one at the app root — there's no per-event deep
// link to send it to (v1 scope; §8a has no notification-detail page),
// so "bring the app to the front" is the entire interaction.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const existing = allClients.find((c): c is WindowClient => "focus" in c);
      if (existing) {
        await existing.focus();
        return;
      }
      await self.clients.openWindow("/");
    })(),
  );
});
