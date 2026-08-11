// Formalized backup script — ARCHITECTURE.md §13/§7: since §7's reversal,
// this SQLite file is the ONLY durability story for real household data (no
// Google-side copy exists anymore), so this replaces the earlier one-off
// manual `.backup()` snapshot with a real, repeatable, rotated script.
//
// What it does:
//   1. Opens the real dev/prod database read-only (backend/data/our-calendar.sqlite —
//      never backend/data-e2e/, see the DB_DIR_NAME guard below).
//   2. Uses better-sqlite3's `.backup()` — SQLite's Online Backup API — to
//      write a single consistent-snapshot file into <repo root>/backups/,
//      which is gitignored (see .gitignore) and lives outside the tracked
//      repo. This is safe to run against a live WAL-mode DB mid-write;
//      it's the same API used for the original hand-taken snapshot.
//   3. Deletes backup files older than BACKUP_RETENTION_DAYS (~2 weeks),
//      so backups/ doesn't grow unbounded.
//
// Usage: `npm run backup` (from backend/), or `node scripts/backup.mjs`.
//
// Scheduling (manual one-time setup, not automated by this script):
//   Windows Task Scheduler → Create Task → Trigger: Daily, a time the PC is
//   normally on → Action: Start a program →
//     Program/script:  node
//     Arguments:        scripts/backup.mjs
//     Start in:          C:\Users\ericm\projects\our-calendar\backend
//   (Use the full path to node.exe if Task Scheduler's limited PATH can't
//   find it — see `where node` from a normal terminal.) Run whether the
//   user is logged on or not; "Run with highest privileges" not required.
//   Verify by right-clicking the task → Run, then checking backups/ for a
//   fresh timestamped file.
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BACKUP_RETENTION_DAYS = 14;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.dirname(__dirname);
const repoRoot = path.dirname(backendRoot);

// Deliberately hardcoded to "data", never DB_DIR_NAME — this script backs
// up the real household database specifically, regardless of what a
// concurrently-running isolated e2e instance has set in its own
// environment. See backend/src/db/client.ts / scripts/reset-and-dev.mjs for
// the "data" vs "data-e2e" isolation this mirrors.
const dbPath = path.join(backendRoot, "data", "our-calendar.sqlite");
const backupsDir = path.join(repoRoot, "backups");

function timestampedName() {
  // Colons aren't valid in Windows filenames — same replacement the
  // pre-existing hand-taken snapshot in backups/ already uses.
  const stamp = new Date().toISOString().replace(/:/g, "-");
  return `our-calendar-${stamp}.sqlite`;
}

async function main() {
  if (!fs.existsSync(dbPath)) {
    console.error(`[backup] No database found at ${dbPath} — nothing to back up.`);
    process.exitCode = 1;
    return;
  }

  fs.mkdirSync(backupsDir, { recursive: true });

  const destPath = path.join(backupsDir, timestampedName());
  const source = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    await source.backup(destPath);
  } finally {
    source.close();
  }

  const { size } = fs.statSync(destPath);
  console.log(`[backup] Wrote ${destPath} (${(size / 1024).toFixed(1)} KB)`);

  rotateOldBackups();
}

function rotateOldBackups() {
  const cutoff = Date.now() - BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const entries = fs.readdirSync(backupsDir).filter((name) => name.startsWith("our-calendar-"));

  let removed = 0;
  for (const name of entries) {
    const filePath = path.join(backupsDir, name);
    const stat = fs.statSync(filePath);
    if (stat.mtimeMs < cutoff) {
      fs.rmSync(filePath, { force: true });
      removed += 1;
    }
  }
  if (removed > 0) {
    console.log(`[backup] Rotated out ${removed} file(s) older than ${BACKUP_RETENTION_DAYS} days.`);
  }
}

main().catch((err) => {
  console.error("[backup] Failed:", err);
  process.exitCode = 1;
});
