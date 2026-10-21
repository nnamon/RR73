/**
 * The monitor output on a computer (Settings › Radio and audio › Monitor): Tx audio also plays
 * on a second device, such as the computer's speakers, at its own level, while the signal goes to
 * the radio's output. The context's destination keeps feeding the radio; a MediaStream
 * destination feeds an audio element whose output is the monitor device. Needs
 * HTMLMediaElement.setSinkId, which Chrome and Edge have on computers; iOS sends all audio to one
 * device, so the iPhone offers no monitor.
 */

/** True where an audio element can choose its output device. */
export function monitorSupported(): boolean {
  return typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
}

let el: HTMLAudioElement | null = null;
let dest: MediaStreamAudioDestinationNode | null = null;
let destCtx: AudioContext | null = null;
let sink: string | null = null;

/**
 * The node Tx audio connects to for the monitor on `ctx`, playing on `deviceId` at `level` (0 to
 * 1); null with no monitor chosen or no output choice.
 */
export function monitorNode(ctx: AudioContext, deviceId: string | null, level: number): AudioNode | null {
  if (!deviceId || !monitorSupported() || typeof ctx.createMediaStreamDestination !== 'function') return null;
  if (!dest || destCtx !== ctx || !el) {
    el?.pause();
    dest = ctx.createMediaStreamDestination();
    destCtx = ctx;
    el = new Audio();
    el.srcObject = dest.stream;
    sink = null;
  }
  if (sink !== deviceId) {
    sink = deviceId;
    void (el as HTMLAudioElement & { setSinkId(id: string): Promise<void> }).setSinkId(deviceId).catch(() => undefined);
  }
  el.volume = Math.max(0, Math.min(1, level));
  void el.play().catch(() => undefined);
  return dest;
}
