// Used only by the isolated Playwright e2e run (see root playwright.config.ts).
// Wipes this checkout's SQLite data directory before booting the backend, so
// every `npm run test:e2e` starts from a guaranteed-empty DB — the seed
// script then re-populates its fixed sample rows on boot, and no test-run
// residue accumulates across repeated runs. Never used by normal `npm run
// dev` (see backend/package.json) so a real dev/prod data/ directory is
// never at risk of this touching it.
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { spawn } from "node:child_process";

const backendRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataDir = path.join(backendRoot, "data");

rmSync(dataDir, { recursive: true, force: true });

const child = spawn("npx", ["tsx", "watch", "src/index.ts"], {
  cwd: backendRoot,
  stdio: "inherit",
  shell: true,
});

child.on("exit", (code) => process.exit(code ?? 0));
