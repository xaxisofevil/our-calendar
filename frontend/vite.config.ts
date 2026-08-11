import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
// BACKEND_PORT lets an isolated test run (see playwright.config.ts) point
// the dev proxy at its own backend instance instead of the normal :3001
// dev/prod one — defaults to 3001 so plain `npm run dev` is unaffected.
const backendPort = process.env.BACKEND_PORT || '3001'

// ARCHITECTURE.md §4 "PWA": vite-plugin-pwa (Workbox) generates the
// manifest + service worker. The service worker caches the **app shell
// only** (JS/CSS/icons, via generateSW's default precache of the built
// output) — deliberately NO `runtimeCaching` entries here, so /api/*
// responses are never cached by the service worker. If the network is
// unreachable, fetches to /api/* just fail like any uncached request, and
// the app's own TanStack Query error state (see App.tsx's
// `eventsQuery.isError` banner) is what tells the user, not stale data
// served back as if it were current. Do not add runtimeCaching for /api
// here — that would silently reintroduce the "stale calendar data
// presented as current" failure mode this design explicitly avoids.
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // generateSW (the default) is the right strategy here — Workbox
      // auto-precaches the Vite build output (JS/CSS/icons/index.html)
      // with no hand-written service-worker source to maintain. We only
      // ever add manifest/precache config below, never `workbox.runtimeCaching`.
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
      workbox: {
        // Never let a navigation fallback (SPA deep-link support) resolve
        // for an API path — belt-and-suspenders alongside "no runtimeCaching
        // for /api" above; navigateFallback only matches document
        // navigations anyway, but this keeps the intent explicit.
        navigateFallbackDenylist: [/^\/api\//],
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
})
