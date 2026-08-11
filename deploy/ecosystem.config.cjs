// PM2 process definitions for production (ARCHITECTURE.md §6). Manages
// both the backend AND Caddy under one process manager — deliberately not
// introducing a second service-management mechanism (e.g. NSSM) just for
// Caddy, since PM2 already gives auto-restart-on-crash and (via
// pm2-windows-startup) boot-time persistence, and covers both processes.
//
// Usage (from the repo root):
//   pm2 start deploy/ecosystem.config.cjs
//   pm2 save
//   pm2-startup install   (one-time, registers PM2 itself to launch at boot)
//
// AUTH_PASSCODE and DUCKDNS_API_TOKEN must be set in the environment BEFORE
// running `pm2 start` the first time — PM2 snapshots each app's env at
// start time via process.env below, and `pm2 save` persists that snapshot
// across reboots. See ARCHITECTURE.md §6 for where to get each value and
// how to set them (PowerShell `[Environment]::SetEnvironmentVariable(...)`
// at the User or Machine level, so they're present in future sessions too).

module.exports = {
  apps: [
    {
      name: "our-calendar-backend",
      cwd: "C:/Users/ericm/projects/our-calendar/backend",
      script: "dist/index.js",
      env: {
        NODE_ENV: "production",
        PORT: "3001",
        AUTH_PASSCODE: process.env.AUTH_PASSCODE || "",
      },
    },
    {
      name: "our-calendar-caddy",
      script: "C:/caddy/caddy.exe",
      args: ["run", "--config", "C:/Users/ericm/projects/our-calendar/deploy/Caddyfile"],
      interpreter: "none",
      cwd: "C:/caddy",
      env: {
        DUCKDNS_API_TOKEN: process.env.DUCKDNS_API_TOKEN || "",
      },
    },
  ],
};
