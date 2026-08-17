import express, { Router } from "express";
import rateLimit from "express-rate-limit";
import { DeepgramApiError, DeepgramConfigError, DeepgramTimeoutError, transcribeAudio } from "../lib/deepgram.js";
import { ClaudeCliConfigError } from "../lib/claudeCli.js";
import { runVoiceCommand } from "../lib/voiceCommand.js";
import { hashSessionToken, readCookie, SESSION_COOKIE_NAME } from "../lib/auth.js";
import {
  consumeVoiceConfirmation,
  issueVoiceConfirmation,
  VoiceConfirmationInvalidError,
  VoiceConfirmationStaleError,
} from "../lib/voiceConfirmations.js";
import {
  undoBatchRequestSchema,
  voiceCommandRequestSchema,
  voiceConfirmationRequestSchema,
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

// Operational kill switch, direct request as part of this branch's own
// pre-merge readiness pass: every other control in this file protects
// against a bad *request*; this is the one for "we need the whole feature
// off right now" (a bad rollout, an upstream Claude/Deepgram incident,
// anything not worth a full backend redeploy to react to). Defaults to
// enabled — VOICE_ENABLED must be explicitly set to "false" to turn voice
// off; unset/any other value is the normal, always-on state. Checked first,
// before rate limiting or route logic, so a disabled deployment does the
// least possible work per request. The frontend's own voice UI is
// independent of this (it doesn't poll this state) — this is a backend-only
// switch flipped via the process environment and a restart, not a live
// user-facing toggle.
const voiceEnabled = () => process.env.VOICE_ENABLED !== "false";

voiceRouter.use((req, res, next) => {
  if (!voiceEnabled()) {
    res.status(503).json({ error: "Voice commands are temporarily unavailable." });
    return;
  }
  next();
});

const rateLimitDisabledForTest = () =>
  process.env.NODE_ENV !== "production" && process.env.VOICE_RATE_LIMIT_DISABLED === "1";

// Resource/cost controls, not microphone controls: capture happens in the
// browser before these requests. The aggregate quota covers the composite
// transcribe->command flow while endpoint-specific buckets reject rapid
// duplicate actions. Production can never disable these via env.
voiceRouter.use(
  rateLimit({
    windowMs: 60_000,
    limit: 12,
    standardHeaders: true,
    legacyHeaders: false,
    skip: rateLimitDisabledForTest,
    message: { error: "Too many voice requests. Try again shortly." },
  }),
);

function onePerSecond() {
  return rateLimit({
    windowMs: 1_000,
    limit: 1,
    standardHeaders: true,
    legacyHeaders: false,
    skip: rateLimitDisabledForTest,
    message: { error: "Please wait a moment before trying that voice action again." },
  });
}

let activeTranscriptions = 0;
let commandInFlight = false;

function confirmationSessionKey(req: express.Request): string {
  const token = readCookie(req.headers.cookie, SESSION_COOKIE_NAME);
  return token ? `session:${hashSessionToken(token)}` : `dev-ip:${req.ip}`;
}

// ARCHITECTURE.md §9 — the client uploads exactly one raw audio blob per
// request (MediaRecorder's output on release, e.g. audio/webm), not a
// multipart form — so this is `express.raw()`, scoped to just this route
// (not applied globally in index.ts, since no other route in this app takes
// a non-JSON body). Only audio/* and application/octet-stream are parsed,
// and the 2 MB ceiling is ample for the frontend's hard-capped 15-second
// compressed clip while bounding in-memory request buffering.
const rawAudio = express.raw({ type: ["audio/*", "application/octet-stream"], limit: "2mb" });

voiceRouter.post("/transcribe", onePerSecond(), rawAudio, async (req, res) => {
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    res.status(400).json({ error: "No audio data received." });
    return;
  }

  const contentType = req.headers["content-type"] || "application/octet-stream";
  if (activeTranscriptions >= 2) {
    res.setHeader("Retry-After", "2");
    res.status(429).json({ error: "Voice transcription is busy. Try again shortly." });
    return;
  }

  activeTranscriptions++;
  try {
    // An empty transcript is Deepgram's own valid "didn't catch any speech"
    // result (§9) — returned as-is, not treated as an error. The frontend
    // decides how to represent that to the user (VoiceButton.tsx).
    const { transcript } = await transcribeAudio(req.body, contentType);
    res.status(200).json({ transcript });
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
    if (err instanceof DeepgramTimeoutError) {
      res.status(504).json({ error: "Voice transcription timed out. Please try again." });
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
  } finally {
    activeTranscriptions--;
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
voiceRouter.post("/command", onePerSecond(), async (req, res) => {
  const parsed = voiceCommandRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  if (commandInFlight) {
    res.setHeader("Retry-After", "2");
    res.status(429).json({ outcome: "error", error: "Another voice command is still running." });
    return;
  }

  commandInFlight = true;
  try {
    const result = await runVoiceCommand(parsed.data.transcript);
    if (result.outcome === "needs_confirmation" && result.proposedAction) {
      try {
        const issued = issueVoiceConfirmation(result.proposedAction, confirmationSessionKey(req));
        res.status(200).json({
          ...result,
          confirmationId: issued.confirmationId,
          proposedAction: issued.action,
          summary: issued.action.summary,
        });
      } catch (err) {
        if (
          err instanceof ActionNotFoundError ||
          err instanceof ActionValidationError ||
          err instanceof VoiceConfirmationInvalidError
        ) {
          res.status(200).json({
            outcome: "error",
            modelTier: result.modelTier,
            error: "The proposed change could not be safely prepared for confirmation.",
          });
          return;
        }
        throw err;
      }
      return;
    }
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
  } finally {
    commandInFlight = false;
  }
});

// Executes a server-prepared destructive action with no LLM involved.
// POST /command validates the real target/details, replaces model prose
// with a trusted summary, and stores a two-minute, session-bound pending
// action. The client sends only its opaque, single-use confirmation id.
// consumeVoiceConfirmation also rejects a target changed since proposal.
voiceRouter.post("/confirm", onePerSecond(), (req, res) => {
  const parsed = voiceConfirmationRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    const { type, targetId, details } = consumeVoiceConfirmation(
      parsed.data.confirmationId,
      confirmationSessionKey(req),
    );
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
    if (err instanceof VoiceConfirmationInvalidError) {
      res.status(410).json({ error: err.message });
      return;
    }
    if (err instanceof VoiceConfirmationStaleError) {
      res.status(409).json({ error: err.message });
      return;
    }
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
voiceRouter.post("/undo", onePerSecond(), (req, res) => {
  const parsed = undoBatchRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  res.status(200).json(undoBatch(parsed.data.batchId));
});
