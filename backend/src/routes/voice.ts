import express, { Router } from "express";
import { DeepgramApiError, DeepgramConfigError, transcribeAudio } from "../lib/deepgram.js";

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
    // decides how to represent that to the user (VoiceButton.tsx).
    const transcript = await transcribeAudio(req.body, contentType);
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
