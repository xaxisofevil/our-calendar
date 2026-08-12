import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "./schema.js";

// backend/src/db/client.ts -> backend/data/*.sqlite, independent of cwd so
// `npm run dev` (tsx) and `node dist/index.js` (built) both land the DB file
// in the same place.
//
// DB_DIR_NAME override exists specifically so isolated test runs (see
// playwright.config.ts / backend/scripts/reset-and-dev.mjs) can NEVER touch
// the real dev/prod database, regardless of which checkout or port they run
// from. Port-based isolation alone is not enough: this path is derived from
// __dirname, not from the port, so two backend instances on different ports
// but the same checkout would otherwise share the same database file — this
// env var is the actual isolation mechanism, not an optional nicety.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDirName = process.env.DB_DIR_NAME || "data";
const dataDir = path.join(__dirname, "..", "..", dataDirName);
fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, "our-calendar.sqlite");

const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

// Schema init via plain SQL rather than a drizzle-kit migration pipeline —
// pragmatic for a single-developer M1 where the schema is still moving.
// Worth formalizing into real migrations before the M3 Google-integration
// schema changes land (see report-back notes).
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS todos (
    id            INTEGER PRIMARY KEY,
    text          TEXT NOT NULL,
    notes         TEXT,
    due_at        TEXT,
    completed     INTEGER NOT NULL DEFAULT 0,
    list          TEXT NOT NULL DEFAULT 'household',
    position      INTEGER NOT NULL,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS people (
    id     INTEGER PRIMARY KEY,
    label  TEXT NOT NULL,
    color  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS events (
    id                 INTEGER PRIMARY KEY,
    person_id          INTEGER REFERENCES people(id),
    google_account_id  INTEGER,
    google_event_id    TEXT,
    title              TEXT NOT NULL,
    description        TEXT,
    location           TEXT,
    start_at           TEXT NOT NULL,
    end_at             TEXT NOT NULL,
    all_day            INTEGER NOT NULL DEFAULT 0,
    recurrence_rule    TEXT,
    updated_at         TEXT NOT NULL
  );

  -- ARCHITECTURE.md §5/§11/§12 (M5/M6) — device-session passcode auth.
  CREATE TABLE IF NOT EXISTS device_sessions (
    id            INTEGER PRIMARY KEY,
    token_hash    TEXT NOT NULL UNIQUE,
    device_label  TEXT,
    created_at    TEXT NOT NULL,
    last_seen_at  TEXT NOT NULL
  );

  -- ARCHITECTURE.md §8a/§11/§12 (M5) — one row per opted-in device's Web
  -- Push subscription.
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id            INTEGER PRIMARY KEY,
    endpoint      TEXT NOT NULL UNIQUE,
    p256dh        TEXT NOT NULL,
    auth          TEXT NOT NULL,
    device_label  TEXT,
    created_at    TEXT NOT NULL
  );

  -- ARCHITECTURE.md §8a/§11/§12 (M5) — dedup log so the reminder scanner
  -- (lib/reminders.ts) never double-sends for the same occurrence.
  CREATE TABLE IF NOT EXISTS sent_reminders (
    event_id             INTEGER NOT NULL REFERENCES events(id),
    occurrence_start_at  TEXT NOT NULL,
    sent_at              TEXT NOT NULL,
    PRIMARY KEY (event_id, occurrence_start_at)
  );
`);

// Dev-time migration shims: if an earlier run of this app created a table
// before a column existed, add the column now instead of requiring a manual
// reset (SQLite dev DB, pre-migrations — cheapest safe path; see the
// "schema init via raw SQL" note above).
function ensureColumn(table: string, column: string, ddl: string) {
  const columns = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((c) => c.name === column)) {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl};`);
  }
}
ensureColumn("todos", "notes", "notes TEXT");
ensureColumn("todos", "due_at", "due_at TEXT");
ensureColumn("events", "person_id", "person_id INTEGER REFERENCES people(id)");
ensureColumn("events", "recurrence_rule", "recurrence_rule TEXT");

export const db = drizzle(sqlite, { schema });
export { sqlite };
