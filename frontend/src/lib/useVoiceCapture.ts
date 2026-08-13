import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { confirmVoiceAction, runVoiceCommand, transcribeVoice, undoVoiceBatch } from "./api";
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
}

const IDLE_STATE: VoiceCaptureState = {
  status: "idle",
  transcript: null,
  errorMessage: null,
  commandResult: null,
  actionNote: null,
  actionBusy: false,
};

const UNSUPPORTED_MESSAGE = "Voice input isn't available on this browser.";
const MIC_DENIED_MESSAGE = "Microphone access was blocked — allow it for this site in your browser settings to use voice.";
const NO_MIC_MESSAGE = "No microphone was found on this device.";
const NO_AUDIO_CAPTURED_MESSAGE = "Didn't catch anything that time — try holding the button a little longer.";
const GENERIC_MESSAGE = "Something went wrong capturing that. Please try again.";

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

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const finishRecording = useCallback(
    (recorder: MediaRecorder) => {
      recorder.onstop = () => {
        releaseStream();
        recorderRef.current = null;

        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        chunksRef.current = [];

        if (blob.size === 0) {
          activeRef.current = false;
          setState({ ...IDLE_STATE, status: "error", errorMessage: NO_AUDIO_CAPTURED_MESSAGE });
          return;
        }

        setState({ ...IDLE_STATE, status: "uploading" });
        transcribeVoice(blob)
          .then(async ({ transcript }) => {
            if (!transcript.trim()) {
              // §9's original "didn't catch that" case — nothing for the
              // command layer to act on.
              activeRef.current = false;
              setState({ ...IDLE_STATE, status: "done", transcript });
              return;
            }

            setState({ ...IDLE_STATE, status: "commanding", transcript });
            try {
              const commandResult = await runVoiceCommand(transcript);
              activeRef.current = false;
              if (commandResult.outcome === "executed") refreshData();
              setState({ ...IDLE_STATE, status: "done", transcript, commandResult });
            } catch (err) {
              activeRef.current = false;
              setState({
                ...IDLE_STATE,
                status: "error",
                transcript,
                errorMessage: err instanceof Error ? err.message : GENERIC_MESSAGE,
              });
            }
          })
          .catch((err: unknown) => {
            activeRef.current = false;
            setState({
              ...IDLE_STATE,
              status: "error",
              errorMessage: err instanceof Error ? err.message : GENERIC_MESSAGE,
            });
          });
      };
      recorder.stop();
    },
    [releaseStream, refreshData],
  );

  const start = useCallback(async () => {
    if (!isVoiceCaptureSupported()) {
      setState({ ...IDLE_STATE, status: "error", errorMessage: UNSUPPORTED_MESSAGE });
      return;
    }
    if (activeRef.current) return; // already recording/uploading/commanding — a stray duplicate press

    activeRef.current = true;
    pendingStopRef.current = false;
    setState({ ...IDLE_STATE, status: "recording" });

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
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

    streamRef.current = stream;
    chunksRef.current = [];
    const recorder = new MediaRecorder(stream);
    recorderRef.current = recorder;
    recorder.ondataavailable = (e: BlobEvent) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.start();

    // The button was already released while the permission prompt/
    // getUserMedia call was still in flight — honor that stop now instead
    // of leaving the recording running until the next press.
    if (pendingStopRef.current) {
      pendingStopRef.current = false;
      finishRecording(recorder);
    }
  }, [finishRecording]);

  const stop = useCallback(() => {
    if (!activeRef.current) return;
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      // Recording hasn't actually started yet (still awaiting the
      // permission prompt) — start() will call finishRecording() itself as
      // soon as it does.
      pendingStopRef.current = true;
      return;
    }
    finishRecording(recorder);
  }, [finishRecording]);

  const reset = useCallback(() => {
    setState(IDLE_STATE);
  }, []);

  const confirmAction = useCallback(async () => {
    const action = state.commandResult?.proposedAction;
    if (!action) return;
    setState((s) => ({ ...s, actionBusy: true }));
    try {
      await confirmVoiceAction(action);
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
