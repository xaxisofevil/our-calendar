import { defineConfig, devices } from "@playwright/test";
import {
  E2E_AUTH_PASSCODE,
  E2E_AUTH_STATE_PATH,
  E2E_DEEPGRAM_API_KEY,
  E2E_REMINDER_SCAN_INTERVAL_MS,
  E2E_VAPID_PRIVATE_KEY,
  E2E_VAPID_PUBLIC_KEY,
} from "./e2e/helpers";

// Isolated QA run — never points at the real dev/prod instance (normally
// :5173 frontend / :3001 backend, possibly holding real household data).
// This config starts a dedicated backend on :4001 and a dedicated Vite dev
// server on :4173, wired together via BACKEND_PORT (see frontend/vite.config.ts),
// and the backend wipes its own backend/data/ directory on boot for this run
// (see backend/scripts/reset-and-dev.mjs) so every run starts from the
// seed script's known fixture state.
const BACKEND_PORT = 4001;
const FRONTEND_PORT = 4173;
// ARCHITECTURE.md §9 (M7) — two more isolated processes, just for
// e2e/voice.spec.ts: a mock Deepgram HTTP server (there's no real
// DEEPGRAM_API_KEY available yet — see §9's own "Implementation" note) the
// primary backend above is pointed at via DEEPGRAM_API_URL for the
// success/error-passthrough cases, and a second, minimal backend instance
// that deliberately has no DEEPGRAM_API_KEY configured at all, so
// voice.spec.ts can hit a real "not configured" response without needing
// the primary shared backend (used by every other spec in this suite) to
// flip that config on and off mid-run.
const DEEPGRAM_MOCK_PORT = 4402;
const VOICE_UNCONFIGURED_BACKEND_PORT = 4403;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  // One worker: all tests share a single backend + SQLite file, so keeping
  // them serial avoids cross-test races on shared events/todos state.
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://localhost:${FRONTEND_PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    // Logs in once (e2e/auth.setup.ts) against the isolated backend and
    // writes the resulting session cookie + the notif-prompt-dismissed
    // localStorage entry to E2E_AUTH_STATE_PATH — see that file. Every
    // other spec file starts pre-authenticated via the "chromium" project's
    // `storageState` below, same as this suite already pre-seeded the
    // notif-prompt dismissal before auth existed (ARCHITECTURE.md §5/§12,
    // M5/M6 — auth.spec.ts is the one file that deliberately starts
    // unauthenticated instead, to test the gate itself).
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: "chromium",
      testIgnore: /auth\.setup\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 }, storageState: E2E_AUTH_STATE_PATH },
      dependencies: ["setup"],
    },
  ],
  webServer: [
    {
      command: "npm run dev:e2e",
      cwd: "./backend",
      url: `http://localhost:${BACKEND_PORT}/api/health`,
      // AUTH_PASSCODE, same pattern as PORT above — set only for this
      // isolated backend instance, forwarded to the actual `tsx watch`
      // child process by backend/scripts/reset-and-dev.mjs (which spreads
      // ...process.env). Never a real .env file for e2e — see
      // e2e/helpers.ts's E2E_AUTH_PASSCODE comment.
      //
      // VAPID_*/REMINDER_SCAN_INTERVAL_MS (§8a, M5): a throwaway keypair
      // and a fast scan cadence, isolated-backend-only — see
      // e2e/helpers.ts's E2E_VAPID_PUBLIC_KEY/E2E_REMINDER_SCAN_INTERVAL_MS
      // comments.
      //
      // DEEPGRAM_API_KEY/DEEPGRAM_API_URL (§9, M7): a fake key, and the
      // real Deepgram endpoint swapped for the local mock server started
      // below — see e2e/helpers.ts's E2E_DEEPGRAM_API_KEY comment and
      // e2e/mock-deepgram-server.mjs.
      env: {
        PORT: String(BACKEND_PORT),
        AUTH_PASSCODE: E2E_AUTH_PASSCODE,
        VAPID_PUBLIC_KEY: E2E_VAPID_PUBLIC_KEY,
        VAPID_PRIVATE_KEY: E2E_VAPID_PRIVATE_KEY,
        REMINDER_SCAN_INTERVAL_MS: String(E2E_REMINDER_SCAN_INTERVAL_MS),
        DEEPGRAM_API_KEY: E2E_DEEPGRAM_API_KEY,
        DEEPGRAM_API_URL: `http://localhost:${DEEPGRAM_MOCK_PORT}/v1/listen`,
      },
      reuseExistingServer: false,
      timeout: 30_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: `npm run dev -- --port ${FRONTEND_PORT} --strictPort`,
      cwd: "./frontend",
      url: `http://localhost:${FRONTEND_PORT}`,
      // VITE_VAPID_PUBLIC_KEY (§8a, M5): Vite auto-exposes any VITE_-
      // prefixed process env var via import.meta.env, no .env file needed
      // — same throwaway keypair as the backend's VAPID_PUBLIC_KEY above
      // (see e2e/helpers.ts), so lib/push.ts's enablePushNotifications()
      // doesn't short-circuit as "unsupported" during push-notifications.spec.ts.
      env: { BACKEND_PORT: String(BACKEND_PORT), VITE_VAPID_PUBLIC_KEY: E2E_VAPID_PUBLIC_KEY },
      reuseExistingServer: false,
      timeout: 30_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    // ARCHITECTURE.md §9 (M7) — mock Deepgram HTTP server, see
    // e2e/mock-deepgram-server.mjs's own header for exactly how it decides
    // what to respond with. Plain node:http, no deps, so no separate
    // package/install step.
    {
      command: "node e2e/mock-deepgram-server.mjs",
      cwd: ".",
      url: `http://localhost:${DEEPGRAM_MOCK_PORT}/health`,
      env: { PORT: String(DEEPGRAM_MOCK_PORT) },
      reuseExistingServer: false,
      timeout: 15_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    // ARCHITECTURE.md §9 (M7) — a second, minimal backend instance used
    // only by voice.spec.ts's "DEEPGRAM_API_KEY isn't configured" test (see
    // the constant's own comment above for why this needs to be a separate
    // process rather than toggling the primary backend's config). No
    // AUTH_PASSCODE (requireAuth no-ops when unset, same escape hatch as
    // every other backend instance without it — see middleware/requireAuth.ts),
    // and its own DB_DIR_NAME so it never touches the primary e2e run's
    // SQLite file (voice transcription doesn't touch the database at all,
    // so there's nothing meaningful in this one — it exists purely to be a
    // real running server with Deepgram genuinely unconfigured).
    {
      command: "npx tsx src/index.ts",
      cwd: "./backend",
      url: `http://localhost:${VOICE_UNCONFIGURED_BACKEND_PORT}/api/health`,
      env: {
        PORT: String(VOICE_UNCONFIGURED_BACKEND_PORT),
        DB_DIR_NAME: "data-e2e-voice-unconfigured",
      },
      reuseExistingServer: false,
      timeout: 30_000,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
