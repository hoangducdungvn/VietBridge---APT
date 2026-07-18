// Browser audio capture adapter (doc §17).
// Connects getUserMedia → AudioWorklet (pcm-capture-processor) → AudioFrame events.
//
// R1: Listens for document visibilitychange to resume AudioContext on Safari/iOS
//     which aggressively suspends AudioContext when the tab loses focus.
// R3: Creates AudioContext at 16000 Hz so the browser's native (C++) resampler
//     handles the 48→16 kHz conversion instead of our JS implementation,
//     removing the CPU hot-path on low-end devices.

import { Resampler, type AudioQuality } from "./resampler";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A single resampled audio frame ready for upstream consumption. */
export interface AudioFrame {
  /** 16 kHz mono PCM (signed 16-bit). */
  pcm: Int16Array;
  sampleRateHz: 16000;
  channels: 1;
  /** Monotonic milliseconds elapsed since capture session start. */
  captureStartMs: number;
  /** Duration of this frame in milliseconds. */
  durationMs: number;
  /** Per-frame quality metrics. */
  quality: AudioQuality;
  /** Original sample rate of the capture device before resampling. */
  inputSampleRate: number;
}

/** Observable device state transitions. */
export type DeviceState =
  | { type: "active"; deviceLabel: string }
  | { type: "permission_denied" }
  | { type: "disconnected" }
  | { type: "error"; message: string };

/** Configuration for starting a capture session. */
export interface CaptureConfig {
  /** Specific `deviceId` to capture from, or omit for the default device. */
  deviceId?: string;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

/**
 * Captures audio from the browser via `getUserMedia` + an AudioWorklet,
 * resamples to 16 kHz mono Int16 PCM, and emits `AudioFrame` objects.
 */
export class WebAudioCaptureAdapter {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private resampler: Resampler | null = null;
  private sessionStartTime: number = 0;

  private frameHandler: ((frame: AudioFrame) => void) | null = null;
  private deviceHandler: ((state: DeviceState) => void) | null = null;

  /** Bound listener references for clean removal. */
  private boundOnDeviceChange: (() => void) | null = null;
  private boundOnTrackEnded: (() => void) | null = null;
  /** R1: Safari/iOS AudioContext resume on tab focus restore. */
  private boundOnVisibilityChange: (() => void) | null = null;

  // -------------------------------------------------------------------------
  // Handler registration
  // -------------------------------------------------------------------------

  /** Register a callback invoked for every captured audio frame. */
  onAudioFrame(handler: (frame: AudioFrame) => void): void {
    this.frameHandler = handler;
  }

  /** Register a callback invoked on device state changes. */
  onDeviceState(handler: (state: DeviceState) => void): void {
    this.deviceHandler = handler;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Start capturing audio.
   *
   * 1. Acquire a `MediaStream` via `getUserMedia`.
   * 2. Create an `AudioContext` and load the `pcm-capture-processor` worklet.
   * 3. Wire source → worklet and begin emitting frames.
   */
  async start(config?: CaptureConfig): Promise<void> {
    // ---- 1. getUserMedia ----
    if (typeof navigator.mediaDevices?.getUserMedia !== "function") {
      const message =
        "Microphone access requires HTTPS or localhost. This browser does not allow it on the current origin.";
      this.deviceHandler?.({ type: "error", message });
      throw new Error(message);
    }

    const constraints: MediaStreamConstraints = {
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        ...(config?.deviceId ? { deviceId: { exact: config.deviceId } } : {}),
      },
    };

    try {
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        this.deviceHandler?.({ type: "permission_denied" });
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      this.deviceHandler?.({ type: "error", message });
      throw err;
    }

    // ---- 2. Verify actual MediaTrackSettings (doc §17 note) ----
    const track = this.stream.getAudioTracks()[0];
    if (!track) {
      this.deviceHandler?.({
        type: "error",
        message: "No audio track available",
      });
      this.releaseStream();
      return;
    }

    const settings = track.getSettings();
    // Log a warning if the browser gave us something unexpected; we still
    // proceed because the resampler handles arbitrary input rates.
    if (settings.channelCount && settings.channelCount !== 1) {
      console.warn(
        `[CaptureAdapter] Expected 1 channel, got ${settings.channelCount}. ` +
          "Proceeding with first channel only.",
      );
    }

    // ---- 3. AudioContext + Worklet ----
    // R3: Request 16 kHz directly — the browser's native (C++) resampler
    // handles the 48→16 kHz conversion, eliminating the JS hot-path.
    // Safari silently ignores unsupported rates and falls back to its native
    // rate, so we always read context.sampleRate for the actual value.
    this.context = new AudioContext({ sampleRate: 16000 });
    const inputSampleRate = this.context.sampleRate;

    await this.context.audioWorklet.addModule("/worklet/pcm-processor.js");

    this.workletNode = new AudioWorkletNode(
      this.context,
      "pcm-capture-processor",
    );
    this.sourceNode = this.context.createMediaStreamSource(this.stream);
    this.sourceNode.connect(this.workletNode);
    // Do NOT connect the worklet to context.destination — we only need the
    // data; playing it back would cause feedback.

    // ---- 4. Resampler ----
    // R3: If the browser honoured our 16 kHz request (inputSampleRate === 16000),
    // the Resampler becomes a no-op pass-through (ratio=1). On Safari where the
    // context rate may differ, it still does the right thing via linear interpolation.
    this.resampler = new Resampler(inputSampleRate, 16000);

    // ---- 5. Session clock ----
    this.sessionStartTime = performance.now();

    // ---- 6. Worklet → main thread message handler ----
    this.workletNode.port.onmessage = (event: MessageEvent) => {
      const { sampleRate: msgSampleRate, frame } = event.data as {
        sampleRate: number;
        frame: Float32Array;
      };

      if (!this.resampler || !this.frameHandler) return;

      const pcm = this.resampler.process(frame);
      if (pcm.length === 0) return;

      const quality = Resampler.computeQuality(frame);
      const captureStartMs = performance.now() - this.sessionStartTime;
      const durationMs = (pcm.length / 16000) * 1000;

      const audioFrame: AudioFrame = {
        pcm,
        sampleRateHz: 16000,
        channels: 1,
        captureStartMs,
        durationMs,
        quality,
        inputSampleRate: msgSampleRate,
      };

      this.frameHandler(audioFrame);
    };

    // ---- 7. Device-change listener ----
    this.boundOnDeviceChange = () => {
      // Re-check whether our track is still live after a device change.
      if (track.readyState === "ended") {
        this.deviceHandler?.({ type: "disconnected" });
      }
    };
    navigator.mediaDevices.addEventListener(
      "devicechange",
      this.boundOnDeviceChange,
    );

    // ---- 8. Track-ended listener ----
    this.boundOnTrackEnded = () => {
      this.deviceHandler?.({ type: "disconnected" });
    };
    track.addEventListener("ended", this.boundOnTrackEnded);

    // ---- R1: visibilitychange — Safari/iOS AudioContext suspend fix ----
    // Safari suspends the AudioContext whenever the page loses focus (tab
    // switch, lock screen, home button).  We resume it as soon as the page
    // becomes visible again so recording continues without interruption.
    this.boundOnVisibilityChange = async () => {
      if (
        document.visibilityState === "visible" &&
        this.context?.state === "suspended"
      ) {
        try {
          await this.context.resume();
          console.info(
            "[CaptureAdapter] AudioContext resumed after visibility change (Safari fix)",
          );
        } catch (e) {
          console.warn("[CaptureAdapter] Failed to resume AudioContext:", e);
        }
      }
    };
    document.addEventListener("visibilitychange", this.boundOnVisibilityChange);

    if (this.context.state === "suspended") {
      await this.context.resume();
    }
    if (this.context.state === "suspended") {
      const message =
        "Browser blocked automatic microphone activation. Click the microphone button.";
      this.deviceHandler?.({ type: "error", message });
      throw new Error(message);
    }

    // ---- 9. Emit active state ----
    this.deviceHandler?.({
      type: "active",
      deviceLabel: track.label || "Unknown microphone",
    });
  }

  /**
   * Stop the capture session and release all resources.
   */
  async stop(): Promise<void> {
    // Disconnect worklet
    if (this.workletNode) {
      this.workletNode.port.onmessage = null;
      this.workletNode.disconnect();
      this.workletNode = null;
    }

    // Disconnect source
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }

    // Close AudioContext
    if (this.context) {
      try {
        await this.context.close();
      } catch {
        // Already closed — safe to ignore.
      }
      this.context = null;
    }

    // Stop MediaStream tracks
    this.releaseStream();

    // Remove global listeners
    if (this.boundOnDeviceChange) {
      navigator.mediaDevices.removeEventListener(
        "devicechange",
        this.boundOnDeviceChange,
      );
      this.boundOnDeviceChange = null;
    }
    this.boundOnTrackEnded = null;
    // R1: Remove visibilitychange listener
    if (this.boundOnVisibilityChange) {
      document.removeEventListener(
        "visibilitychange",
        this.boundOnVisibilityChange,
      );
      this.boundOnVisibilityChange = null;
    }

    // Reset resampler
    if (this.resampler) {
      this.resampler.reset();
      this.resampler = null;
    }
  }

  // -------------------------------------------------------------------------
  // Static helpers
  // -------------------------------------------------------------------------

  /** List available audio input devices. */
  static async listDevices(): Promise<MediaDeviceInfo[]> {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === "audioinput");
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /** Stop all tracks on the current MediaStream and clear the reference. */
  private releaseStream(): void {
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.removeEventListener(
          "ended",
          this.boundOnTrackEnded as EventListener,
        );
        track.stop();
      }
      this.stream = null;
    }
  }
}
