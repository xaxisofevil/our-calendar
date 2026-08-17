import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { confirmVoiceAction, runVoiceCommand, transcribeVoice, undoVoiceBatch } from "./api";
import { isStandalonePwa } from "./pwa";
import type { VoiceCommandResult } from "../types";

export type VoiceCaptureStatus = "idle" | "recording" | "uploading" | "commanding" | "done" | "error";

interface VoiceCaptureState {
  status: VoiceCaptureStatus;
  transcript: string | null;
  errorMessage: string | null;
  // ARCHITECTURE.md §10/§12 (M8) — the result of actually acting on the
  // transcript (POST /api/voice/command), once §9's transcription step has
  // produced a non-empty transcript. Null for the whole §9-only "didn't
  // catch that"/empty-transcript case, which never calls the command layer
  // at all (see finishRecording below).
  commandResult: VoiceCommandResult | null;
  // Feedback from a follow-up action on an already-shown result (Confirm/
  // Cancel/Undo) — kept separate from errorMessage/commandResult so
  // e.g. "Undone." can replace the toast's body without pretending a new
  // voice command just ran.
  actionNote: string | null;
  actionBusy: boolean;
  // Direct request: replace one static "Working on it…" for the whole
  // `commanding` wait (which can genuinely run 10-40s+ — §10's own
  // observed research-path latency) with a few progressively-more-honest
  // messages over time. This is *not* real backend progress reporting —
  // there's no channel for that without a much bigger streaming change —
  // just a plain client-side timer advancing through
  // COMMANDING_PHASE_MESSAGES below. A wait that visibly changes reads as
  // shorter than a static spinner even at the same real duration.
  commandingPhase: number;
}

const IDLE_STATE: VoiceCaptureState = {
  status: "idle",
  transcript: null,
  errorMessage: null,
  commandResult: null,
  actionNote: null,
  actionBusy: false,
  commandingPhase: 0,
};

// Exported so VoiceButton.tsx can render the exact text for the current
// phase without duplicating this list. Thresholds are deliberately
// conservative — round 1's own observed baseline for a simple direct-tool
// call was already ~4s, so the first phase shouldn't flip before that.
export const COMMANDING_PHASE_MESSAGES = ["Understanding…", "Looking that up…", "Still working on it — might be doing some research…"];
const COMMANDING_PHASE_THRESHOLDS_MS = [4_000, 12_000]; // advance to phase 1 at 4s, phase 2 at 12s

const UNSUPPORTED_MESSAGE = "Voice input isn't available on this browser.";
const MIC_DENIED_MESSAGE = "Microphone access was blocked — allow it for this site in your browser settings to use voice.";
const NO_MIC_MESSAGE = "No microphone was found on this device.";
const NO_AUDIO_CAPTURED_MESSAGE = "Didn't catch anything that time — try holding the button a little longer.";
const GENERIC_MESSAGE = "Something went wrong capturing that. Please try again.";
const PWA_ONLY_MESSAGE = "Voice input is available only from the installed app.";
// Privacy backstop: pointer capture is reliable in normal use, but no lost
// pointer/browser lifecycle edge case may leave a microphone open forever.
const MAX_RECORDING_MS = 15_000;

function isVoiceCaptureSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === "function" &&
    typeof window !== "undefined" &&
    typeof window.MediaRecorder === "function"
  );
}

/**
 * ARCHITECTURE.md §9/§10 (M7/M8) — push-to-talk capture (`start()`/
 * `stop()`, unchanged from §9) plus acting on the result: once
 * `POST /api/voice/transcribe` returns a non-empty transcript, this now
 * goes on to call `POST /api/voice/command` (lib/api.ts's
 * `runVoiceCommand`) itself, rather than just displaying the transcript
 * (§9's original, deliberately-stopped-short scope). An empty transcript
 * (Deepgram genuinely heard nothing) still short-circuits to the plain
 * "didn't catch that" display exactly as before — there's nothing for the
 * command layer to act on.
 *
 * `confirmAction`/`cancelAction`/`undoBatch` handle the two follow-up
 * flows `commandResult` can leave outstanding: a `needs_confirmation`
 * outcome (Confirm actually executes the proposed destructive action via
 * POST /api/voice/confirm — no LLM involved, see that route's own
 * comment; Cancel just discards it client-side, nothing to tell the
 * server) or an `executed` outcome (Undo reverses the whole batch via
 * POST /api/voice/undo). No auto-listening / voice-driven confirmation
 * here on purpose — that's explicitly a follow-up piece of work layered on
 * top of this, not part of this pass.
 */
export function useVoiceCapture() {
  const [state, setState] = useState<VoiceCaptureState>(IDLE_STATE);
  const queryClient = useQueryClient();
  // Real bug, found via direct report: this hook never invalidated the
  // events/todos query caches itself after a successful command/confirm/
  // undo — it relied entirely on useLiveSync's SSE round-trip to notice
  // its *own* change and refresh the view, which is backwards. SSE exists
  // so *other* tabs learn about a change; the tab that just made the
  // change already knows for certain one happened and shouldn't need a
  // network round-trip back to itself to find out — especially not one
  // that can be delayed or missed if the tab was backgrounded during a
  // slow voice command (mobile browsers throttle/suspend background
  // EventSource connections). Invalidating both keys unconditionally
  // (rather than trying to infer event-vs-todo from the result) is simple
  // and always correct — create_event/add_todo are voice's only two
  // direct-write tools, and a wasted refetch of the one that didn't
  // change is cheap.
  const refreshData = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["events"] });
    queryClient.invalidateQueries({ queryKey: ["todos"] });
  }, [queryClient]);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const activeRef = useRef(false); // true from the moment start() is called until upload+command settle
  const pendingStopRef = useRef(false);
  const pendingMediaRef = useRef(false);
  const recordingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  const mountedRef = useRef(true);

  const releaseStream = useCallback(() => {
    if (recordingTimerRef.current !== null) {
      clearTimeout(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const finishRecording = useCallback(
    (recorder: MediaRecorder) => {
      if (recorder.state === "inactive") return;
      const attempt = attemptRef.current;

      recorder.onstop = () => {
        releaseStream();
        if (recorderRef.current === recorder) recorderRef.current = null;

        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        chunksRef.current = [];
        if (!mountedRef.current || attemptRef.current !== attempt) return;

        if (blob.size === 0) {
          activeRef.current = false;
          setState({ ...IDLE_STATE, status: "error", errorMessage: NO_AUDIO_CAPTURED_MESSAGE });
          return;
        }

        setState({ ...IDLE_STATE, status: "uploading" });
        transcribeVoice(blob)
          .then(async ({ transcript }) => {
            if (!mountedRef.current || attemptRef.current !== attempt) return;
            if (!transcript.trim()) {
              activeRef.current = false;
              setState({ ...IDLE_STATE, status: "done", transcript });
              return;
            }

            setState({ ...IDLE_STATE, status: "commanding", transcript });
            const phaseTimers = COMMANDING_PHASE_THRESHOLDS_MS.map((ms, i) =>
              setTimeout(() => {
                if (!mountedRef.current || attemptRef.current !== attempt) return;
                setState((s) => (s.status === "commanding" ? { ...s, commandingPhase: i + 1 } : s));
              }, ms),
            );
            try {
              const commandResult = await runVoiceCommand(transcript);
              phaseTimers.forEach(clearTimeout);
              if (!mountedRef.current || attemptRef.current !== attempt) return;
              activeRef.current = false;
              if (commandResult.outcome === "executed") refreshData();
              // The transcript is no longer needed once a structured result
              // exists; do not retain household speech in component state.
              setState({ ...IDLE_STATE, status: "done", commandResult });
            } catch (err) {
              phaseTimers.forEach(clearTimeout);
              if (!mountedRef.current || attemptRef.current !== attempt) return;
              activeRef.current = false;
              setState({
                ...IDLE_STATE,
                status: "error",
                errorMessage: err instanceof Error ? err.message : GENERIC_MESSAGE,
              });
            }
          })
          .catch((err: unknown) => {
            if (!mountedRef.current || attemptRef.current !== attempt) return;
            activeRef.current = false;
            setState({
              ...IDLE_STATE,
              status: "error",
              errorMessage: err instanceof Error ? err.message : GENERIC_MESSAGE,
            });
          });
      };

      try {
        recorder.stop();
      } catch {
        releaseStream();
        recorderRef.current = null;
        chunksRef.current = [];
        activeRef.current = false;
        if (mountedRef.current) setState({ ...IDLE_STATE, status: "error", errorMessage: GENERIC_MESSAGE });
      }
    },
    [releaseStream, refreshData],
  );

  const start = useCallback(async () => {
    if (!isStandalonePwa()) {
      setState({ ...IDLE_STATE, status: "error", errorMessage: PWA_ONLY_MESSAGE });
      return;
    }
    if (!isVoiceCaptureSupported()) {
      setState({ ...IDLE_STATE, status: "error", errorMessage: UNSUPPORTED_MESSAGE });
      return;
    }
    if (activeRef.current) return;

    const attempt = ++attemptRef.current;
    activeRef.current = true;
    pendingStopRef.current = false;
    setState({ ...IDLE_STATE, status: "recording" });

    let stream: MediaStream;
    pendingMediaRef.current = true;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      pendingMediaRef.current = false;
    } catch (err) {
      pendingMediaRef.current = false;
      if (!mountedRef.current || attemptRef.current !== attempt) return;
      activeRef.current = false;
      const name = (err as { name?: string } | undefined)?.name;
      const message =
        name === "NotAllowedError" || name === "SecurityError"
          ? MIC_DENIED_MESSAGE
          : name === "NotFoundError"
            ? NO_MIC_MESSAGE
            : GENERIC_MESSAGE;
      setState({ ...IDLE_STATE, status: "error", errorMessage: message });
      return;
    }

    // Permission can resolve after release, backgrounding, or unmount.
    // A stale stream is stopped before it is ever attached to a recorder.
    if (!mountedRef.current || attemptRef.current !== attempt || !activeRef.current) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }

    streamRef.current = stream;
    chunksRef.current = [];
    try {
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorder.ondataavailable = (e: BlobEvent) => {
        if (attemptRef.current === attempt && e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onerror = () => {
        releaseStream();
        recorderRef.current = null;
        chunksRef.current = [];
        activeRef.current = false;
        if (mountedRef.current && attemptRef.current === attempt) {
          setState({ ...IDLE_STATE, status: "error", errorMessage: GENERIC_MESSAGE });
        }
      };
      recorder.start();
      recordingTimerRef.current = setTimeout(() => finishRecording(recorder), MAX_RECORDING_MS);

      if (pendingStopRef.current) {
        pendingStopRef.current = false;
        finishRecording(recorder);
      }
    } catch {
      releaseStream();
      recorderRef.current = null;
      chunksRef.current = [];
      activeRef.current = false;
      if (mountedRef.current && attemptRef.current === attempt) {
        setState({ ...IDLE_STATE, status: "error", errorMessage: GENERIC_MESSAGE });
      }
    }
  }, [finishRecording, releaseStream]);

  const stop = useCallback(() => {
    if (!activeRef.current) return;
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      pendingStopRef.current = true;
      return;
    }
    finishRecording(recorder);
  }, [finishRecording]);

  useEffect(() => {
    const stopIfHidden = () => {
      if (document.visibilityState !== "hidden") return;
      if (pendingMediaRef.current) {
        // Cancel permission acquisition outright. If it resolves later,
        // the attempt-id check stops the returned tracks immediately.
        pendingMediaRef.current = false;
        pendingStopRef.current = false;
        activeRef.current = false;
        attemptRef.current++;
        if (mountedRef.current) setState(IDLE_STATE);
        return;
      }
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") stop();
    };
    document.addEventListener("visibilitychange", stopIfHidden);
    return () => document.removeEventListener("visibilitychange", stopIfHidden);
  }, [stop]);

  // Mutable media refs are intentionally read at teardown: they represent
  // the resources current at unmount, not values from effect setup.
  // oxlint-disable react-hooks/exhaustive-deps
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      attemptRef.current++;
      activeRef.current = false;
      pendingStopRef.current = false;
      pendingMediaRef.current = false;
      const recorder = recorderRef.current;
      recorderRef.current = null;
      if (recorder && recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {
          // Stream cleanup below is the privacy boundary even if recorder
          // shutdown itself fails.
        }
      }
      chunksRef.current = [];
      releaseStream();
    };
  }, [releaseStream]);
  // oxlint-enable react-hooks/exhaustive-deps

  const reset = useCallback(() => {
    setState(IDLE_STATE);
  }, []);

  const confirmAction = useCallback(async () => {
    const confirmationId = state.commandResult?.confirmationId;
    if (!confirmationId) return;
    setState((s) => ({ ...s, actionBusy: true }));
    try {
      await confirmVoiceAction(confirmationId);
      refreshData();
      setState((s) => ({ ...s, actionBusy: false, actionNote: "Done — that's been applied.", commandResult: null }));
    } catch (err) {
      setState((s) => ({
        ...s,
        actionBusy: false,
        actionNote: err instanceof Error ? err.message : GENERIC_MESSAGE,
      }));
    }
  }, [state.commandResult, refreshData]);

  const cancelAction = useCallback(() => {
    setState((s) => ({ ...s, commandResult: null, actionNote: "Cancelled — nothing was changed." }));
  }, []);

  const undoBatch = useCallback(async () => {
    const batchId = state.commandResult?.batchId;
    if (!batchId) return;
    setState((s) => ({ ...s, actionBusy: true }));
    try {
      await undoVoiceBatch(batchId);
      refreshData();
      setState((s) => ({ ...s, actionBusy: false, actionNote: "Undone.", commandResult: null }));
    } catch (err) {
      setState((s) => ({
        ...s,
        actionBusy: false,
        actionNote: err instanceof Error ? err.message : GENERIC_MESSAGE,
      }));
    }
  }, [state.commandResult, refreshData]);

  return {
    ...state,
    start,
    stop,
    reset,
    confirmAction,
    cancelAction,
    undoBatch,
    supported: isVoiceCaptureSupported(),
  };
}
