import { useCallback, useRef, useState } from "react";
import { transcribeVoice } from "./api";

export type VoiceCaptureStatus = "idle" | "recording" | "uploading" | "done" | "error";

interface VoiceCaptureState {
  status: VoiceCaptureStatus;
  transcript: string | null;
  errorMessage: string | null;
}

const IDLE_STATE: VoiceCaptureState = { status: "idle", transcript: null, errorMessage: null };

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
 * ARCHITECTURE.md §9 (M7) — push-to-talk capture: `start()` requests the
 * mic and begins a `MediaRecorder` recording, `stop()` ends it and uploads
 * the single resulting blob to `POST /api/voice/transcribe`
 * (lib/api.ts's `transcribeVoice`). Displays the transcript as-is — §9's
 * scope is capture + transcription only, nothing from §10 (the command
 * layer that would act on it) is built or stubbed here.
 *
 * Press-and-hold, not tap-to-toggle: VoiceButton.tsx calls `start()`/
 * `stop()` from pointerdown/pointerup. §9's own spec wording ("uploaded ...
 * on release") already settles this as a walkie-talkie-style hold, which
 * also can't be left accidentally recording forever if a tap is ever missed
 * on a kitchen tablet — releasing (or the pointer leaving the button, or
 * the gesture being cancelled) always ends the recording.
 *
 * `stop()` can be called before `start()`'s `getUserMedia()` prompt has
 * resolved (a fast tap on the very first use, while the browser's own
 * permission dialog is still up) — `pendingStopRef` remembers that request
 * and applies it the instant recording actually begins, rather than leaving
 * the mic recording indefinitely because the release event had nowhere to
 * land yet.
 */
export function useVoiceCapture() {
  const [state, setState] = useState<VoiceCaptureState>(IDLE_STATE);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const activeRef = useRef(false); // true from the moment start() is called until upload settles
  const pendingStopRef = useRef(false);

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const finishRecording = useCallback((recorder: MediaRecorder) => {
    recorder.onstop = () => {
      releaseStream();
      recorderRef.current = null;

      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
      chunksRef.current = [];

      if (blob.size === 0) {
        activeRef.current = false;
        setState({ status: "error", transcript: null, errorMessage: NO_AUDIO_CAPTURED_MESSAGE });
        return;
      }

      setState({ status: "uploading", transcript: null, errorMessage: null });
      transcribeVoice(blob)
        .then(({ transcript }) => {
          activeRef.current = false;
          setState({ status: "done", transcript, errorMessage: null });
        })
        .catch((err: unknown) => {
          activeRef.current = false;
          setState({
            status: "error",
            transcript: null,
            errorMessage: err instanceof Error ? err.message : GENERIC_MESSAGE,
          });
        });
    };
    recorder.stop();
  }, [releaseStream]);

  const start = useCallback(async () => {
    if (!isVoiceCaptureSupported()) {
      setState({ status: "error", transcript: null, errorMessage: UNSUPPORTED_MESSAGE });
      return;
    }
    if (activeRef.current) return; // already recording/uploading — a stray duplicate press

    activeRef.current = true;
    pendingStopRef.current = false;
    setState({ status: "recording", transcript: null, errorMessage: null });

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
      setState({ status: "error", transcript: null, errorMessage: message });
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

  return { ...state, start, stop, reset, supported: isVoiceCaptureSupported() };
}
