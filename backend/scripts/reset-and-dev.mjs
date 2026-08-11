// Used only by the isolated Playwright e2e run (see root playwright.config.ts).
// Wipes an e2e-only SQLite data directory before booting the backend, so
// every `npm run test:e2e` starts from a guaranteed-empty DB — the seed
// script then re-populates its fixed sample rows on boot, and no test-run
// residue accumulates across repeated runs.
//
// SAFETY: this deletes a directory by NAME ("data-e2e"), never "data" (the
// real dev/prod database's directory), and that name is also passed to the
// backend process via DB_DIR_NAME so client.ts actually opens that separate
// file. This is deliberately NOT relative-path-based isolation (i.e. "we
// happen to be running from a different checkout") — a differently-named
// directory is safe to wipe regardless of which checkout or port this runs
// from, which matters because port-based isolation alone does not protect
// the database (see the comment in backend/src/db/client.ts).
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { spawn } from "node:child_process";

const E2E_DB_DIR_NAME = "data-e2e";

const backendRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataDir = path.join(backendRoot, E2E_DB_DIR_NAME);

rmSync(dataDir, { recursive: true, force: true });

const child = spawn("npx", ["tsx", "watch", "src/index.ts"], {
  cwd: backendRoot,
  stdio: "inherit",
  shell: true,
  env: { ...process.env, DB_DIR_NAME: E2E_DB_DIR_NAME },
});

child.on("exit", (code) => process.exit(code ?? 0));
