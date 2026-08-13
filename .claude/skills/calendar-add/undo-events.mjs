#!/usr/bin/env node
// calendar-add skill helper: undoes exactly one batch created by
// add-events.mjs -- reads its manifest, deletes exactly those event ids
// (nothing else, no pattern-matching/guessing), then marks the manifest
// as undone (renamed, not removed -- keeps an audit trail of what was
// added and later reverted).
//
// Usage: node undo-events.mjs <batch-id-or-partial-match>
//   Pass "latest" to undo the most recently created (still-active) batch.
import { deleteEvent } from "../../../backend/dist/actions/events.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const runsDir = path.join(__dirname, "runs");

const [, , query] = process.argv;
if (!query) {
  console.error("Usage: node undo-events.mjs <batch-id-or-partial-match | latest>");
  process.exit(1);
}

const manifests = fs
  .readdirSync(runsDir)
  .filter((f) => f.endsWith(".json") && !f.endsWith(".undone.json"))
  .sort();

let manifestFile;
if (query === "latest") {
  manifestFile = manifests[manifests.length - 1];
} else {
  manifestFile = manifests.find((f) => f.includes(query));
}

if (!manifestFile) {
  console.error(`No active (not-yet-undone) batch found matching "${query}".`);
  console.error(`Active batches: ${manifests.join(", ") || "(none)"}`);
  process.exit(1);
}

const manifestPath = path.join(runsDir, manifestFile);
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

console.log(`Undoing batch: ${manifest.batchId} (${manifest.events.length} events)`);
let deleted = 0;
let missing = 0;
for (const e of manifest.events) {
  try {
    deleteEvent(e.id);
    console.log(`Deleted #${e.id}: ${e.title}`);
    deleted++;
  } catch (err) {
    // Already deleted by hand (e.g. via the app) -- not an error, the
    // desired end state (it's gone) already holds.
    console.log(`#${e.id}: ${e.title} — already gone (${err.message})`);
    missing++;
  }
}

const undonePath = manifestPath.replace(/\.json$/, ".undone.json");
fs.renameSync(manifestPath, undonePath);

console.log(`\nDone: ${deleted} deleted, ${missing} already gone. Manifest archived as ${path.basename(undonePath)}.`);
