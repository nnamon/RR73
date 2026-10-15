/**
 * The audio output device. Chromium's AudioContext.setSinkId sends everything the context plays
 * (FT8, FT4, WSPR and RTTY transmissions, Tune) to the chosen device, and
 * HTMLMediaElement.setSinkId does the same for the start chime. Safari and Firefox have no
 * AudioContext.setSinkId, so the choice shows only in Chromium (docs/design/cat.md, Audio).
 *
 * Measured in Chromium 153: setSinkId on a running context fires `suspended` and then `running`
 * within 5 ms, and a context created with a missing device in its options suspends itself. So the
 * engine creates the context without a device and switches it after (engine.ts).
 */

/** The part of AudioContext that output choice uses. TypeScript's DOM types lack it. */
export interface SinkContext {
  setSinkId?(sinkId: string): Promise<void>;
}

/**
 * Why the chosen output does not play: `missing` when the browser does not have the device (a
 * radio switched off or unplugged), `unsupported` without setSinkId, `failed` for any other
 * refusal. Audio then plays through the system default.
 */
export type OutputError = 'missing' | 'unsupported' | 'failed';

export interface OutputState {
  /** The chosen output device, or null for the system default. */
  sinkId: string | null;
  /** Why the chosen device does not play, or null when it plays or none is chosen. */
  error: OutputError | null;
}

/** True where the browser can send an AudioContext's output to a chosen device. */
export function outputChoiceSupported(proto: object | undefined = globalThis.AudioContext?.prototype): boolean {
  return !!proto && typeof (proto as SinkContext).setSinkId === 'function';
}

/** Sends the context's output to `sinkId`, or to the system default for null. Resolves null once it plays there. */
export async function applySink(ctx: SinkContext, sinkId: string | null): Promise<OutputError | null> {
  if (typeof ctx.setSinkId !== 'function') return sinkId ? 'unsupported' : null;
  try {
    await ctx.setSinkId(sinkId ?? '');
    return null;
  } catch (e) {
    const name = e && typeof e === 'object' && 'name' in e ? (e as { name: unknown }).name : null;
    return name === 'NotFoundError' ? 'missing' : 'failed';
  }
}

/** The audio outputs among `devices`, without the browser's own "default" entry, which System default covers. */
export function outputChoices(devices: readonly MediaDeviceInfo[]): MediaDeviceInfo[] {
  return devices.filter((d) => d.kind === 'audiooutput' && d.deviceId && d.deviceId !== 'default');
}

/**
 * What a device change means for the chosen output: `gone` when it left the browser's list,
 * `back` when it is listed again after leaving or after a switch found it missing, null otherwise.
 * A list without device IDs (no microphone permission yet) tells nothing, so it gives null.
 */
export function outputChange(chosen: string | null, wasListed: boolean, devices: readonly MediaDeviceInfo[], error: OutputError | null): 'gone' | 'back' | null {
  const outputs = outputChoices(devices);
  if (chosen === null || outputs.length === 0) return null;
  const listed = outputs.some((d) => d.deviceId === chosen);
  if (wasListed && !listed) return 'gone';
  if (listed && (!wasListed || error === 'missing')) return 'back';
  return null;
}

/** The audio inputs among `devices`, without the browser's own "default" and "communications" entries. */
export function inputChoices(devices: readonly MediaDeviceInfo[]): MediaDeviceInfo[] {
  return devices.filter((d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications');
}

/**
 * The ID of the device saved as `savedId` and `savedLabel` among `choices`: the saved ID while the
 * browser lists it; otherwise the ID of the one device with the saved name, as when the browser
 * gave the device a new ID (another USB port, cleared site data, a private window); otherwise the
 * saved ID. Two devices with the same name are not guessed between.
 */
export function matchDevice(choices: readonly MediaDeviceInfo[], savedId: string, savedLabel: string): string {
  if (choices.some((d) => d.deviceId === savedId) || !savedLabel) return savedId;
  const named = choices.filter((d) => d.label === savedLabel);
  return named.length === 1 ? named[0].deviceId : savedId;
}

/** matchDevice for the outputs. */
export function matchOutput(devices: readonly MediaDeviceInfo[], savedId: string, savedLabel: string): string {
  return matchDevice(outputChoices(devices), savedId, savedLabel);
}

/** matchDevice for the inputs. */
export function matchInput(devices: readonly MediaDeviceInfo[], savedId: string, savedLabel: string): string {
  return matchDevice(inputChoices(devices), savedId, savedLabel);
}
