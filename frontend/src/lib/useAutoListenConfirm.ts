import { useEffect, useRef, useState } from "react";
import { transcribeVoice } from "./api";
import { evaluateConfirmTranscript } from "./voiceConfirmWhitelist";
import type { ProposedDestructiveAction } from "../types";

export type AutoListenStatus = "idle" | "listening" | "evaluating";

interface UseAutoListenConfirmOptions {
  // The proposed action currently awaiting confirmation, or undefined/null
  // when there isn't one. A *new object* here (a fresh needs_confirmation
  // result) is what starts a fresh auto-listen attempt — this hook never
  // re-runs just because the component re-rendered.
  proposedAction: ProposedDestructiveAction | null | undefined;
  onConfirm: () => void;
  onCancel: () => void;
}

// Test-only overrides, read once per attempt from `window` — never set in
// production, so these constants below are exactly what ships. Exists
// because a real getUserMedia()'d MediaStream is required for the
// AnalyserNode-based silence detection below to do anything (a mocked
// e2e stream isn't a real MediaStream, so createMediaStreamSource() can't
// work against it — see this file's own try/catch around that), which
// would otherwise force e2e/voice-auto-confirm.spec.ts to wait out a real
// 10-second timer per test. Same spirit as this app's other test-only
// injection points (deepgram.ts's fetchImpl, claudeCli.ts's spawnImpl) —
// a seam for substituting timing/IO in tests, not a behavior change.
function testOverrideMs(key: string, fallback: number): number {
  if (typeof window === "undefined") return fallback;
  const value = (window as unknown as Record<string, unknown>)[key];
  return typeof value === "number" ? value : fallback;
}

const MAX_RECORD_MS = testOverrideMs("__AUTO_LISTEN_MAX_MS__", 10_000);
// A "natural pause" per the spec: 1-1.5s of quiet following actual speech.
const SILENCE_MS = testOverrideMs("__AUTO_LISTEN_SILENCE_MS__", 1_300);
const POLL_INTERVAL_MS = 100;
// A basic RMS/amplitude threshold on Web Audio's byte time-domain data
// (0-255, centered at 128) — normalized to a 0-1 scale. Not
// sophisticated VAD, just "is there real signal above the noise floor" —
// per ARCHITECTURE.md §10b, that's deliberately all this needs to be.
const SPEECH_RMS_THRESHOLD = 0.03;

/**
 * ARCHITECTURE.md §10b (M9) — auto-opens the microphone the moment a
 * `needs_confirmation` voice-command result appears (no new tap — mic
 * permission was already granted earlier in the same interaction, the
 * original voice command that led here), listens for up to
 * MAX_RECORD_MS, and evaluates what it heard against the whitelist gate
 * (voiceConfirmWhitelist.ts). A clear, high-confidence "yes" calls
 * `onConfirm`; a clear, high-confidence "no" calls `onCancel`; anything
 * else — silence, a timeout, low confidence, ambiguous phrasing, or
 * getUserMedia failing outright — does nothing and lets the existing
 * manual Confirm/Cancel buttons stand exactly as they already did before
 * this feature existed. This hook never sets an error message and never
 * throws out of its effect — every failure path here is deliberately
 * silent, per the feature's own explicit design (never block or degrade
 * the manual-confirm flow).
 *
 * A distinct hook rather than a mode bolted onto useVoiceCapture.ts on
 * purpose: that hook's whole shape (activeRef/pendingStopRef, one
 * MediaRecorder tied to pointerdown/pointerup) is built around a single
 * press-and-hold session started by a user gesture. This is a genuinely
 * different mode — self-starting, time-boxed, silence-terminated, and
 * evaluated against a narrow whitelist instead of driving the full
 * command pipeline — and folding it into useVoiceCapture would mean
 * threading a second state machine through code that has no other reason
 * to know about auto-listen at all. The two hooks share nothing but the
 * browser APIs and `transcribeVoice`, which is exactly the amount of
 * reuse that made sense here.
 */
export function useAutoListenConfirm({ proposedAction, onConfirm, onCancel }: UseAutoListenConfirmOptions) {
  const [status, setStatus] = useState<AutoListenStatus>("idle");
  const attemptRef = useRef(0);
  // Always call the *latest* callback identity, not whatever was captured
  // when this attempt's effect started — confirmAction/cancelAction in
  // useVoiceCapture.ts are recreated on every state change.
  const onConfirmRef = useRef(onConfirm);
  onConfirmRef.current = onConfirm;
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  useEffect(() => {
    if (!proposedAction) return;
    const attempt = ++attemptRef.current;
    let cancelled = false;
    let stream: MediaStream | null = null;
    let audioCtx: AudioContext | null = null;
    let recorder: MediaRecorder | null = null;
    let pollHandle: ReturnType<typeof setInterval> | null = null;
    let maxTimer: ReturnType<typeof setTimeout> | null = null;
    const chunks: Blob[] = [];

    function stopAnalysing() {
      if (pollHandle !== null) clearInterval(pollHandle);
      if (maxTimer !== null) clearTimeout(maxTimer);
      pollHandle = null;
      maxTimer = null;
      if (audioCtx && audioCtx.state !== "closed") {
        audioCtx.close().catch(() => {
          // Nothing to do if closing fails — the AudioContext is being
          // torn down regardless, and this is never surfaced to the user.
        });
      }
      audioCtx = null;
    }

    function releaseStream() {
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
    }

    async function run() {
      let mediaStream: MediaStream;
      try {
        // The one thing this whole feature depends on: calling
        // getUserMedia() with no new user gesture, relying on the
        // permission already granted earlier in this page session (the
        // original voice command that produced this proposal). Confirmed
        // (not assumed) that this is standard, supported browser behavior
        // once permission is origin-scoped and already granted — see
        // ARCHITECTURE.md §10b's "verified" note for the sources and the
        // one open caveat (real iOS Safari device behavior). Whatever the
        // reason this fails for — permission somehow unavailable, a
        // browser quirk, anything — the catch below is the load-bearing
        // part of that promise: fail silently, never block the manual
        // buttons.
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        if (attemptRef.current === attempt) setStatus("idle");
        return;
      }
      if (cancelled || attemptRef.current !== attempt) {
        mediaStream.getTracks().forEach((track) => track.stop());
        return;
      }
      stream = mediaStream;
      setStatus("listening");

      recorder = new MediaRecorder(stream);
      const activeRecorder = recorder;
      activeRecorder.ondataavailable = (e: BlobEvent) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      const stopped = new Promise<void>((resolve) => {
        activeRecorder.onstop = () => resolve();
      });
      activeRecorder.start();

      // Silence detection: a lightweight AnalyserNode volume check, not
      // real VAD — per ARCHITECTURE.md §10b that's a deliberate choice,
      // not a corner cut. Skipped gracefully (falls back to the flat
      // MAX_RECORD_MS timeout below) if Web Audio isn't available, or if
      // `stream` isn't a real MediaStream the browser's AudioContext can
      // attach to (only ever true in this project's own mocked e2e
      // harness — see testOverrideMs's own comment above).
      const AudioContextClass =
        window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      let speechDetected = false;
      let lastLoudAt = Date.now();
      if (AudioContextClass) {
        try {
          audioCtx = new AudioContextClass();
          // Chrome only auto-suspends an AudioContext created *before* the
          // document has received any user gesture (developer.chrome.com's
          // autoplay-policy doc) — this one is always created after the
          // real gesture that started the original press-and-hold
          // recording, so it should already init "running." resume() is a
          // harmless, defensive no-op in that case, and the real fix if
          // that assumption is ever wrong on some browser — it's never an
          // error to call resume() on an already-running context.
          void audioCtx.resume().catch(() => {});
          const source = audioCtx.createMediaStreamSource(stream);
          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 2048;
          source.connect(analyser);
          const buffer = new Uint8Array(analyser.fftSize);
          pollHandle = setInterval(() => {
            analyser.getByteTimeDomainData(buffer);
            let sumSquares = 0;
            for (let i = 0; i < buffer.length; i++) {
              const normalized = (buffer[i] - 128) / 128;
              sumSquares += normalized * normalized;
            }
            const rms = Math.sqrt(sumSquares / buffer.length);
            const now = Date.now();
            if (rms > SPEECH_RMS_THRESHOLD) {
              speechDetected = true;
              lastLoudAt = now;
            } else if (speechDetected && now - lastLoudAt >= SILENCE_MS) {
              if (activeRecorder.state !== "inactive") activeRecorder.stop();
            }
          }, POLL_INTERVAL_MS);
        } catch {
          // Web Audio unavailable or unable to attach to this stream —
          // MAX_RECORD_MS below is still a correct (if less prompt) bound,
          // so this degrades to "always record the full window" rather
          // than failing the whole attempt.
        }
      }

      maxTimer = setTimeout(() => {
        if (activeRecorder.state !== "inactive") activeRecorder.stop();
      }, MAX_RECORD_MS);

      await stopped;
      stopAnalysing();
      releaseStream();

      if (cancelled || attemptRef.current !== attempt) return;

      const blob = new Blob(chunks, { type: activeRecorder.mimeType || "audio/webm" });
      if (blob.size === 0) {
        setStatus("idle");
        return;
      }

      setStatus("evaluating");
      try {
        const { words } = await transcribeVoice(blob);
        if (cancelled || attemptRef.current !== attempt) return;
        const decision = evaluateConfirmTranscript(words);
        if (decision === "confirm") onConfirmRef.current();
        else if (decision === "cancel") onCancelRef.current();
        // decision === null: garbled/silent/low-confidence/ambiguous/
        // timed-out-with-nothing-usable — do nothing, manual buttons stand.
      } catch {
        // Transcription failed (network hiccup, transient server error,
        // ...) — silently do nothing, same as an unclear result.
      } finally {
        if (attemptRef.current === attempt) setStatus("idle");
      }
    }

    run();

    return () => {
      cancelled = true;
      stopAnalysing();
      releaseStream();
      if (recorder && recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {
          // Already stopping/stopped — nothing to do.
        }
      }
    };
  }, [proposedAction]);

  return { status };
}
