/**
 * iOS mutes Web Audio while the ring switch is on silent until a media element has played
 * during a user gesture. Setting the audio session type alone did not unmute output on the
 * owner's iPhone. Each tap that needs output plays one clip through an <audio> element: the
 * start tone when audio starts, a short silent clip for Resume audio and Tune.
 *
 * The start tone is audible on purpose. It keys the radio's VOX for 0.4 s, which the keying
 * check uses to confirm the radio transmits when RR73 plays audio.
 */

/** Sample rate of generated clips, Hz. */
export const CLIP_RATE = 12000;

export interface StartTone {
  /** Silence before the tone, s: the microphone opens during it and gives the receive baseline. */
  leadS: number;
  /** Tone length, s. */
  toneS: number;
  /** Tone frequency, Hz. */
  hz: number;
  /** Raised-cosine ramp at each end, s, so the tone does not click or splatter. */
  rampS: number;
}

export const START_TONE: StartTone = { leadS: 1.5, toneS: 0.4, hz: 1500, rampS: 0.005 };

/** Samples of the start tone clip at `level` peak (0 to 1): lead silence, tone, 0.2 s tail. */
export function startToneSamples(level: number, t: StartTone = START_TONE, rate = CLIP_RATE): Float32Array {
  const lead = Math.round(t.leadS * rate);
  const tone = Math.round(t.toneS * rate);
  const tail = Math.round(0.2 * rate);
  const ramp = Math.max(1, Math.round(t.rampS * rate));
  const out = new Float32Array(lead + tone + tail);
  const amp = Math.min(1, Math.max(0, level));
  for (let i = 0; i < tone; i++) {
    const edge = Math.min(i, tone - 1 - i);
    const gain = edge < ramp ? 0.5 - 0.5 * Math.cos((Math.PI * edge) / ramp) : 1;
    out[lead + i] = amp * gain * Math.sin((2 * Math.PI * t.hz * i) / rate);
  }
  return out;
}

/** A data URI for a 16-bit mono PCM WAV of `samples` (-1 to 1) at `rate` Hz. */
export function wavDataUri(samples: Float32Array, rate = CLIP_RATE): string {
  const data = samples.length * 2;
  const v = new DataView(new ArrayBuffer(44 + data));
  const text = (offset: number, s: string) => [...s].forEach((c, i) => v.setUint8(offset + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  v.setUint32(4, 36 + data, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  text(36, 'data');
  v.setUint32(40, data, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, Math.round(s * 32767), true);
  }
  const bytes = new Uint8Array(v.buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:audio/wav;base64,${btoa(binary)}`;
}

let silentUri: string | null = null;

/** 0.1 s of digital silence. */
export function silentClipUri(): string {
  silentUri ??= wavDataUri(new Float32Array(Math.round(0.1 * CLIP_RATE)));
  return silentUri;
}

/**
 * Plays a clip through a media element. Call synchronously inside a tap handler, before any
 * await, or iOS does not count it as part of the gesture. Returns performance.now() at the call.
 * Refusals are ignored: other browsers do not mute output in the first place.
 */
export function playClip(uri: string, doc: Document = document, now: () => number = () => performance.now()): number {
  const at = now();
  try {
    const el = doc.createElement('audio');
    el.setAttribute('playsinline', '');
    el.src = uri;
    void el.play().catch(() => undefined);
  } catch {
    // Nothing to unlock on this browser.
  }
  return at;
}
