import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
// BACKEND_PORT lets an isolated test run (see playwright.config.ts) point
// the dev proxy at its own backend instance instead of the normal :3001
// dev/prod one — defaults to 3001 so plain `npm run dev` is unaffected.
const backendPort = process.env.BACKEND_PORT || '3001'

// Real incident, found via direct report: a production build was run from a
// shell whose process predated a User-level env var being set (Windows
// doesn't propagate newly-set persistent env vars to already-running
// processes), so `npm run build` silently produced a bundle with
// VITE_VAPID_PUBLIC_KEY missing. Vite bakes VITE_-prefixed vars in at build
// time with no built-in warning if one is absent, so that shipped straight
// to production: enablePushNotifications() (frontend/src/lib/push.ts)
// returns "unsupported" immediately whenever the key is falsy, meaning
// Notification.requestPermission() is never even called — every device
// silently got zero permission prompt, with no error anywhere to notice.
// Fail loud and immediate instead, but only for `vite build` (a real
// deploy) — `vite dev`/`vite preview` and the e2e harness (playwright.config.ts
// sets this explicitly via its own throwaway VAPID keypair) legitimately
// don't always need it.
if (process.env.npm_lifecycle_event === 'build' && !process.env.VITE_VAPID_PUBLIC_KEY) {
  throw new Error(
    'VITE_VAPID_PUBLIC_KEY is not set in this shell — a production build would silently ' +
      'ship with push notifications broken (see this comment in vite.config.ts). Set it ' +
      '(it is a User-level env var on the deploy machine; a fresh shell/process may not have ' +
      'inherited it) and re-run the build.',
  )
}

// ARCHITECTURE.md §4 "PWA": vite-plugin-pwa (Workbox) generates the
// manifest + service worker. The service worker caches the **app shell
// only** (JS/CSS/icons, via the injected precache manifest below) —
// deliberately NO runtime-caching of /api/* anywhere in
// `frontend/src/sw.ts`. If the network is unreachable, fetches to /api/*
// just fail like any uncached request, and the app's own TanStack Query
// error state (see App.tsx's `eventsQuery.isError` banner) is what tells
// the user, not stale data served back as if it were current. Do not add
// runtime caching for /api in sw.ts — that would silently reintroduce the
// "stale calendar data presented as current" failure mode this design
// explicitly avoids.
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // M5 (ARCHITECTURE.md §8a) switched this from `generateSW` (M4's
      // default) to `injectManifest`: real Web Push needs a hand-written
      // `push`/`notificationclick` listener on the service worker, which
      // `generateSW`'s auto-generated file has no hook for — see
      // src/sw.ts's header comment for the full reasoning. `srcDir`/
      // `filename` point at that hand-written source; vite-plugin-pwa's
      // only remaining job is injecting the precache manifest into it
      // (`self.__WB_MANIFEST` in sw.ts) and generating manifest.json/icons
      // exactly as before — none of that changed.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      manifestFilename: 'manifest.json',
      includeAssets: ['icons/apple-touch-icon.png', 'favicon.svg'],
      manifest: {
        name: 'Our Calendar',
        short_name: 'Our Calendar',
        description: 'Family calendar and to-do dashboard.',
        // Paper & Ink skin tokens (frontend/src/styles/tokens.css),
        // light-mode values — theme_color tints the OS/browser chrome
        // (status bar, task switcher), background_color is the install
        // splash-screen background before the app's own CSS paints.
        theme_color: '#b0512e',
        background_color: '#f3ecdd',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'icons/pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: 'icons/maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      // `workbox` (generateSW-only) is gone along with that strategy — its
      // old `navigateFallbackDenylist` doesn't apply here: this app has no
      // client-side routing (no react-router) needing an SPA navigation
      // fallback in the first place, and sw.ts never calls
      // `registerRoute()`/`setCatchHandler()` for anything, /api/* included
      // — see sw.ts's header comment. `injectManifest` below configures
      // what actually gets swept into the precache manifest instead.
      injectManifest: {
        // Explicit rather than relying on workbox-build's default globs —
        // parity with the old generateSW precache (JS/CSS/HTML + the icon
        // set + manifest.json), so "app shell" still means the same thing
        // it did before this strategy switch.
        globPatterns: ['**/*.{js,css,html,svg,png,json}'],
      },
      // Lets the service worker register under plain `vite`/`vite dev` too
      // (not just a production build+preview), so both the isolated e2e
      // suite (which runs against the Vite dev server, see
      // playwright.config.ts) and local dev can exercise real
      // registration/installability checks.
      devOptions: {
        enabled: true,
        type: 'module',
      },
    }),
  ],
  server: {
    host: true,
    allowedHosts: ['.trycloudflare.com'],
    proxy: {
      '/api': {
        target: `http://localhost:${backendPort}`,
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: true,
    proxy: {
      '/api': {
        target: `http://localhost:${backendPort}`,
        changeOrigin: true,
      },
    },
  },
})
