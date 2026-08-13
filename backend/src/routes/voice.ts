import express, { Router } from "express";
import { DeepgramApiError, DeepgramConfigError, transcribeAudio } from "../lib/deepgram.js";
import { ClaudeCliConfigError } from "../lib/claudeCli.js";
import { runVoiceCommand } from "../lib/voiceCommand.js";
import {
  proposedDestructiveActionSchema,
  undoBatchRequestSchema,
  voiceCommandRequestSchema,
} from "../lib/validation.js";
import {
  ActionNotFoundError,
  ActionValidationError,
  deleteEvent,
  deleteTodo,
  undoBatch,
  updateEvent,
  updateTodo,
} from "../actions/index.js";

export const voiceRouter = Router();

// ARCHITECTURE.md §9 — the client uploads exactly one raw audio blob per
// request (MediaRecorder's output on release, e.g. audio/webm), not a
// multipart form — so this is `express.raw()`, scoped to just this route
// (not applied globally in index.ts, since no other route in this app takes
// a non-JSON body). `type: "*/*"` accepts whatever content-type the browser
// actually sent (varies by browser/codec support) rather than requiring an
// exact match. 15mb is a generous ceiling for a short push-to-talk clip —
// real captures are a few seconds of compressed audio, far under this —
// just enough to reject something clearly wrong rather than buffering an
// unbounded upload into memory.
const rawAudio = express.raw({ type: "*/*", limit: "15mb" });

voiceRouter.post("/transcribe", rawAudio, async (req, res) => {
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    res.status(400).json({ error: "No audio data received." });
    return;
  }

  const contentType = req.headers["content-type"] || "application/octet-stream";

  try {
    // An empty transcript is Deepgram's own valid "didn't catch any speech"
    // result (§9) — returned as-is, not treated as an error. The frontend
    // decides how to represent that to the user (VoiceButton.tsx). `words`
    // (§10b, M9) is the per-word confidence data the frontend's auto-listen
    // confirm gate needs — every existing caller of this route already
    // ignores unknown response fields, so this is purely additive.
    const { transcript, words } = await transcribeAudio(req.body, contentType);
    res.status(200).json({ transcript, words });
  } catch (err) {
    if (err instanceof DeepgramConfigError) {
      // Logged without the error's own detail beyond "not configured" —
      // there's no key value to leak, but this also avoids ever echoing
      // env content into logs as a matter of habit (mirrors
      // lib/reminders.ts's VAPID-missing warning, which does the same).
      console.error("[voice] Deepgram is not configured (DEEPGRAM_API_KEY missing).");
      res.status(500).json({ error: "Voice transcription isn't set up yet." });
      return;
    }
    if (err instanceof DeepgramApiError) {
      // Deliberately doesn't relay Deepgram's own response body to the
      // client or the log — see DeepgramApiError's own comment for why.
      console.error(`[voice] Deepgram API error, status ${err.status}`);
      res.status(502).json({ error: "Couldn't reach the transcription service. Please try again." });
      return;
    }
    throw err;
  }
});

// ARCHITECTURE.md §10/§12 (M8) — takes a transcript (from POST
// /api/voice/transcribe above) and actually acts on it, via the haiku/
// sonnet mechanism in lib/voiceCommand.ts. See that file for the full
// outcome/security reasoning; this handler is deliberately thin —
// validate the request shape, run the command, translate the one
// exception type worth a distinct response (`ClaudeCliConfigError`, same
// "operator hasn't configured this yet" 500 pattern as
// `DeepgramConfigError` above) into a clear response, and otherwise pass
// `runVoiceCommand`'s own result straight through — it already returns a
// fully-formed `VoiceCommandResult` for every other case (including a
// failed LLM invocation, which resolves to `{ outcome: "error" }` rather
// than throwing — see that file's own comment on why).
voiceRouter.post("/command", async (req, res) => {
  const parsed = voiceCommandRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    const result = await runVoiceCommand(parsed.data.transcript);
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof ClaudeCliConfigError) {
      // Never logs/returns the error's own message beyond a fixed generic
      // string — mirrors DeepgramConfigError's handling above exactly;
      // there's no secret value to leak here either, just a consistent
      // "don't echo internal config-error text to the client" habit.
      console.error("[voice] Claude Code isn't configured (CLAUDE_CODE_OAUTH_TOKEN missing).");
      res.status(500).json({ outcome: "error", error: "Voice commands aren't set up yet." });
      return;
    }
    throw err;
  }
});

// ARCHITECTURE.md §10/§12 (M8) — executes a previously-proposed destructive
// action (a `proposedDestructiveAction` a POST /api/voice/command response
// returned with `outcome: "needs_confirmation"`). Stateless by design: the
// frontend echoes back the exact proposed action object, this route
// re-validates it (never re-trusts anything about it beyond that shape —
// `targetId`/`type`/`details` all get real validation, `details` a second
// time via updateEvent/updateTodo's own zod schemas) and executes it
// directly through the real action-layer functions. No LLM is involved in
// this handler at all, on purpose — see ARCHITECTURE.md §10's security
// note: the whole point of the "propose, don't execute" split for
// destructive actions is that a misheard/ambiguous transcript can never
// directly delete or overwrite a real, already-scheduled commitment, and
// that only holds if the confirm step is a plain, ordinary REST mutation
// through the exact same code path a household member clicking "Delete"
// in the UI would go through — not a second, LLM-mediated execution path
// that could itself be fooled.
//
// Considered keeping server-side pending-confirmation state instead (the
// backend remembers what it proposed, the frontend just sends back an id)
// — rejected: this is a single-household, already-`requireAuth`-gated app
// with no adversarial multi-tenant concern (ARCHITECTURE.md §5), so there
// is no real actor this state would be defending against that
// re-validating the echoed action doesn't already cover, and stateless
// means no cleanup/expiry logic for an abandoned proposal nobody ever
// confirms.
voiceRouter.post("/confirm", (req, res) => {
  const parsed = proposedDestructiveActionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { type, targetId, details } = parsed.data;
  try {
    switch (type) {
      case "delete_event":
        deleteEvent(targetId);
        break;
      case "update_event":
        updateEvent(targetId, details);
        break;
      case "delete_todo":
        deleteTodo(targetId);
        break;
      case "update_todo":
        updateTodo(targetId, details);
        break;
    }
    res.status(200).json({ outcome: "executed" });
  } catch (err) {
    if (err instanceof ActionNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    if (err instanceof ActionValidationError) {
      res.status(400).json({ error: err.issues });
      return;
    }
    throw err;
  }
});

// ARCHITECTURE.md §10a-2's own "Not built here, and left for §10/M8" note —
// the one minimal HTTP surface for `undoBatch` (actions/batches.ts), so a
// household member can undo whatever a voice command just created. Not
// voice-specific in principle (any future batch-tagging caller could use
// this too), but lives here for now since the voice command layer is the
// first and only caller that needs it over HTTP — see that file's own
// comment for the reasoning a plain "undo everything with this id" call
// never needs to fail on an already-undone or unrecognized batch id.
voiceRouter.post("/undo", (req, res) => {
  const parsed = undoBatchRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  res.status(200).json(undoBatch(parsed.data.batchId));
});
