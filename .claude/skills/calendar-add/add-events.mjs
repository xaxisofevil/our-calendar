#!/usr/bin/env node
// calendar-add skill helper: creates a batch of real events via the same
// action layer the REST API / MCP server use (backend/src/actions/
// events.ts's createEvent -- validated, broadcasts SSE to live clients,
// same as any other real event creation), tags each one's description
// with the batch id, and writes a manifest recording exactly what was
// created so undo-events.mjs can remove precisely this batch later and
// nothing else.
//
// Usage: node add-events.mjs <batch-label> <events.json>
//   events.json: an array of objects matching createEventSchema
//     (title, startAt, endAt, allDay?, personId?, location?, description?)
//   batch-label: short human-readable label, e.g. "bills-2026-schedule" --
//     becomes part of the batch id and the manifest filename.
import { createEvent } from "../../../backend/dist/actions/events.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const runsDir = path.join(__dirname, "runs");
fs.mkdirSync(runsDir, { recursive: true });

const [, , label, eventsPath] = process.argv;
if (!label || !eventsPath) {
  console.error("Usage: node add-events.mjs <batch-label> <events.json>");
  process.exit(1);
}

const events = JSON.parse(fs.readFileSync(eventsPath, "utf8"));
if (!Array.isArray(events) || events.length === 0) {
  console.error("events.json must be a non-empty array");
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const batchId = `${label}-${stamp}`;
const tag = `[calendar-add:${batchId}]`;

const created = [];
try {
  for (const e of events) {
    const description = e.description ? `${e.description}\n\n${tag}` : tag;
    const event = createEvent({ ...e, description });
    created.push({ id: event.id, title: event.title, startAt: event.startAt });
    console.log(`Created #${event.id}: ${event.title} — ${event.startAt}`);
  }
} finally {
  // Write the manifest even on partial failure -- a half-completed batch
  // still needs to be cleanly undoable, that's the whole point.
  const manifestPath = path.join(runsDir, `${batchId}.json`);
  fs.writeFileSync(
    manifestPath,
    JSON.stringify({ batchId, createdAt: new Date().toISOString(), label, events: created }, null, 2),
  );
  console.log(`\nManifest: ${manifestPath}`);
}

console.log(`\nDone: ${created.length}/${events.length} events created. Batch id: ${batchId}`);
