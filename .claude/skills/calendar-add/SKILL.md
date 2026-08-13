---
name: calendar-add
description: Adds real events to the Our Calendar household calendar from a natural-language directive (e.g. "add all the Buffalo Bills games this season"), researching real facts when needed rather than guessing. Every batch is tagged and manifested so it can be cleanly undone with one command if it's wrong. Use when the user asks to add something to Our Calendar that isn't a single simple event a normal tool call would cover better.
---

# calendar-add

Adds a batch of real events to the real household calendar (`backend/data/our-calendar.sqlite`, same database the app/MCP server/REST API use), from a directive that may need research to fulfill correctly (sports schedules, holidays, etc.) — and makes every batch cleanly, precisely undoable, because a directive can be misread or the underlying facts can be wrong.

## Core rule: never guess verifiable facts

If the directive references something with a real, checkable answer (a sports team's schedule, a holiday's date, a recurring public event) — fetch it from at least one live, reliable source before creating anything. Cross-check against a second independent source when the data is easy to get wrong (dates, kickoff times, timezones) — this is not optional for anything going onto a real family calendar. If a fact is genuinely unavailable or not yet finalized (e.g. an NFL flex-scheduled week with no set date), skip that one item, say so explicitly, and don't fabricate a placeholder date.

## Workflow

1. **Understand the directive.** What's being added, over what time range, does it repeat regularly (weekly, etc. — a real RRULE candidate) or is it an irregular list of one-off dates (most sports schedules — different days of the week, byes, no clean pattern — these should be individual events, not a forced recurrence rule)?

2. **Research if needed.** Use WebFetch/WebSearch against reliable, current sources. Never rely on training-data memory for anything date/time-specific that's checkable live — it can be stale or wrong, and this is a real calendar real people will see.

3. **Resolve ambiguity with sensible defaults, and say what you picked:**
   - No specific household member mentioned → leave `personId` unset (household-wide, not attributed to one person).
   - No explicit end time → default to a reasonable duration for that kind of event (e.g. ~3.5h for a sports game), not a zero-length event.
   - Times are in the household's local timezone (Eastern) — convert local wall-clock time to the correct UTC ISO string yourself (mind DST boundaries: EDT is UTC-4, EST is UTC-5 — check which applies to each specific date, don't assume one offset for the whole batch).
   - Title format: short and glanceable (a month-grid cell is small) — e.g. "Bills @ Texans" not the full "Buffalo Bills at Houston Texans presented by...".

4. **Build the events array** as JSON matching `createEventSchema` (see `backend/src/lib/validation.ts`): `title` (required), `startAt`/`endAt` (required, ISO 8601 UTC strings), `allDay`, `personId`, `location`, `description` (all optional). Write it to a temp file.

5. **Run the helper script** from the repo root:
   ```
   node .claude/skills/calendar-add/add-events.mjs <short-batch-label> <path-to-events.json>
   ```
   This calls the same `createEvent` action the REST API and MCP server use (validated, broadcasts live-sync to any open browser tab), tags each created event's description with `[calendar-add:<batch-id>]`, and writes a manifest to `.claude/skills/calendar-add/runs/<batch-id>.json` recording exactly which event ids were created. Requires `backend/` to have a current build (`npm run build` in `backend/` if `dist/actions/events.js` is stale/missing).

6. **Report back**: what was added (count + a few examples), anything skipped and why (e.g. a TBD date), and the batch id — tell the user they can say "undo the \<label\> batch" (or "undo the last thing you added") to cleanly remove exactly this batch and nothing else, no manual cleanup needed.

## Undoing a batch

When the user asks to undo/remove a batch this skill created:
```
node .claude/skills/calendar-add/undo-events.mjs <batch-id-or-partial-match>
```
or `latest` for the most recently created still-active batch. This deletes exactly the event ids recorded in that batch's manifest (nothing pattern-matched or guessed at deletion time) and archives the manifest (renamed to `.undone.json`, not deleted — keeps an audit trail). Confirm with the user which batch if there's any ambiguity — `runs/*.json` (excluding `*.undone.json`) lists all currently-active (not yet undone) batches.

## Why tag-and-manifest instead of just deleting by title/date match afterward

Because "the agent gets it wrong" is the exact failure mode this exists to protect against — if the directive was misread, some created events might not look like what you'd expect to search for afterward. A manifest recorded at creation time, from the actual ids `createEvent` returned, is the only reliably precise way to undo exactly what was added and nothing the household added separately around the same time.
