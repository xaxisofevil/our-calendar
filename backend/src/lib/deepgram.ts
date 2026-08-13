// ARCHITECTURE.md §9 — a thin wrapper around Deepgram's pre-recorded
// transcription REST endpoint (not the streaming/WebSocket API — §9's own
// reasoning: simpler, and for short push-to-talk commands the latency
// difference is imperceptible). Takes a raw audio buffer + its
// content-type, returns the transcript text.
//
// Two things are deliberately injectable rather than hardcoded, so this is
// substitutable in tests without needing a real Deepgram account:
//   - `DEEPGRAM_API_URL` (env, defaults to the real endpoint) — the
//     isolated e2e suite points this at a local mock server instead (see
//     e2e/mock-deepgram-server.mjs, playwright.config.ts). There is no real
//     DEEPGRAM_API_KEY available yet (see this file's own README-in-code
//     below and ARCHITECTURE.md §9's Implementation note).
//   - `fetchImpl` (function param, defaults to the global fetch) — mirrors
//     this codebase's existing instinct for making an external network call
//     substitutable (e.g. lib/reminders.ts's `ensureVapid()` escape hatch
//     for VAPID being unconfigured is the same "don't let an unconfigured
//     integration crash things confusingly" idea applied to push).

const DEFAULT_DEEPGRAM_API_URL = "https://api.deepgram.com/v1/listen?smart_format=true";

/** Thrown when `DEEPGRAM_API_KEY` isn't set — a clear, specific error
 * instead of letting the request fail downstream with a confusing "fetch
 * failed" or a Deepgram 401. Never carries the key value (there isn't one
 * to leak here), and routes/voice.ts never logs/returns this message's
 * details beyond a fixed, generic client-facing string. */
export class DeepgramConfigError extends Error {
  constructor() {
    super("DEEPGRAM_API_KEY is not set — see backend/.env.example.");
    this.name = "DeepgramConfigError";
  }
}

/** Thrown for any non-2xx response from Deepgram itself (bad/expired key,
 * malformed audio, quota, upstream outage, ...). Deliberately carries only
 * the HTTP status, not Deepgram's response body — routes/voice.ts's 502
 * must never relay whatever Deepgram actually said (could include
 * account-identifying detail) to the client, and this class never reads
 * that body in the first place so there's nothing to accidentally forward
 * or log later. */
export class DeepgramApiError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`Deepgram API responded with status ${status}`);
    this.name = "DeepgramApiError";
    this.status = status;
  }
}

interface DeepgramListenResponse {
  results?: {
    channels?: Array<{
      alternatives?: Array<{ transcript?: string }>;
    }>;
  };
}

/**
 * Sends one audio clip to Deepgram's pre-recorded transcription endpoint
 * and returns the transcript text. An empty string is a valid, non-error
 * result (Deepgram genuinely found no speech — a silent/unintelligible
 * clip, §9's own "didn't catch that" case), not something this function
 * treats specially.
 *
 * Throws `DeepgramConfigError` if `DEEPGRAM_API_KEY` isn't set, or
 * `DeepgramApiError` if Deepgram responds with a non-2xx status.
 */
export async function transcribeAudio(
  audio: Buffer,
  contentType: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) throw new DeepgramConfigError();

  const url = process.env.DEEPGRAM_API_URL || DEFAULT_DEEPGRAM_API_URL;

  const res = await fetchImpl(url, {
    method: "POST",
    headers: {
      Authorization: `Token ${apiKey}`,
      "Content-Type": contentType || "application/octet-stream",
    },
    // @types/node's fetch BodyInit typing doesn't include Node's `Buffer`
    // even though it's a real Uint8Array at runtime (undici, which Node's
    // global fetch is built on, accepts it directly) — a plain cast rather
    // than a real conversion, since there's nothing to actually convert.
    body: audio as unknown as BodyInit,
  });

  if (!res.ok) throw new DeepgramApiError(res.status);

  const data = (await res.json()) as DeepgramListenResponse;
  return data.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "";
}
