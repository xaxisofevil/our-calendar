import { defineConfig, devices } from "@playwright/test";

// Isolated QA run — never points at the real dev/prod instance (normally
// :5173 frontend / :3001 backend, possibly holding real household data).
// This config starts a dedicated backend on :4001 and a dedicated Vite dev
// server on :4173, wired together via BACKEND_PORT (see frontend/vite.config.ts),
// and the backend wipes its own backend/data/ directory on boot for this run
// (see backend/scripts/reset-and-dev.mjs) so every run starts from the
// seed script's known fixture state.
const BACKEND_PORT = 4001;
const FRONTEND_PORT = 4173;

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
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: [
    {
      command: "npm run dev:e2e",
      cwd: "./backend",
      url: `http://localhost:${BACKEND_PORT}/api/health`,
      env: { PORT: String(BACKEND_PORT) },
      reuseExistingServer: false,
      timeout: 30_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: `npm run dev -- --port ${FRONTEND_PORT} --strictPort`,
      cwd: "./frontend",
      url: `http://localhost:${FRONTEND_PORT}`,
      env: { BACKEND_PORT: String(BACKEND_PORT) },
      reuseExistingServer: false,
      timeout: 30_000,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
