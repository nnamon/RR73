// Where captured audio comes from. The capture engine opens one input source and connects its
// node to the capture worklet: the microphone (the radio through the headset contact), or the
// practice band (lib/practice/source.ts), which needs no microphone permission.

import { captureConstraints, readReport, type CaptureReport } from './report';

/** Why capture could not start. */
export type StartError = 'insecure' | 'unsupported' | 'denied' | 'no-device' | 'busy' | 'worklet' | 'unknown';

/** An open input: a node in the capture context that feeds the capture worklet. */
export interface OpenedInput {
  node: AudioNode;
  report: CaptureReport;
  /** True while capture can resume after an interruption without opening the input again. */
  usable(): boolean;
  close(): void;
}

/** Calls from an open input when it stops by itself. */
export interface InputEvents {
  ended(): void;
  muted(): void;
}

export interface InputSource {
  /** Why the source cannot open in this browser, or null. */
  unavailable(): StartError | null;
  /** Opens the input in `ctx`. Call from a tap: the microphone asks for permission. Throws a DOMException when it cannot. */
  open(ctx: AudioContext, deviceId: string | null, events: InputEvents): Promise<OpenedInput>;
}

export interface MicrophoneDeps {
  getUserMedia(c: MediaStreamConstraints): Promise<MediaStream>;
  secure(): boolean;
  setSession(): string | null;
}

/** The microphone: the radio's audio through the headset contact. */
export function microphoneInput(deps: MicrophoneDeps): InputSource {
  return {
    unavailable: () => (deps.secure() ? null : 'insecure'),
    async open(ctx, deviceId, events) {
      const stream = await deps.getUserMedia(captureConstraints(deviceId));
      const stop = () => stream.getTracks().forEach((t) => t.stop());
      const track = stream.getAudioTracks()[0];
      if (!track) {
        stop();
        throw new DOMException('No audio track.', 'NotFoundError');
      }
      let source: MediaStreamAudioSourceNode;
      try {
        source = ctx.createMediaStreamSource(stream);
      } catch (e) {
        stop();
        throw e;
      }
      track.addEventListener('ended', events.ended);
      track.addEventListener('mute', events.muted);
      return {
        node: source,
        report: readReport(track, ctx.sampleRate, deps.setSession()),
        usable: () => stream.getAudioTracks().some((t) => t.readyState === 'live' && !t.muted),
        close() {
          track.removeEventListener('ended', events.ended);
          track.removeEventListener('mute', events.muted);
          source.disconnect();
          stop();
        },
      };
    },
  };
}
