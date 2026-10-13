// The app's record of a slot, read through Save slot: the sidecar's capture fields and the audio.
// The decode tests use it to tell a slot that lost audio from one that had all of it.
import { expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { decodeWav16 } from '../src/lib/slots/wav';

/**
 * Exact-zero runs at least this long count as lost audio: 2 ms at 12 kHz. Received audio after
 * resampling never holds that many exact zeros in a row; the app writes zeros where audio is
 * missing, and the browser does when its audio thread falls behind.
 */
const MIN_ZERO_RUN = 24;

/**
 * A slot with this much lost audio, or audio starting this late, is not judged on its decodes,
 * s. Slots that decoded all 4 messages lost at most 0.075 s; slots that lost 0.15 s or more
 * lost decodes (measured under load, 2026-10-13).
 */
export const LOST_LIMIT_S = 0.1;

export interface AudioLoss {
  /** Silence before audio began: capture started or resumed after the slot start, s. */
  beforeStartS: number;
  /** Exact-zero runs after audio began, s. Chromium's fake microphone adds 0.027 s per loop. */
  lostS: number;
}

/** Silence at the start and exact-zero runs after it in 12 kHz slot audio. */
export function audioLoss(samples: Float32Array, rate = 12000): AudioLoss {
  let start = 0;
  while (start < samples.length && samples[start] === 0) start++;
  let lost = 0;
  for (let i = start; i < samples.length; ) {
    if (samples[i] !== 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < samples.length && samples[j] === 0) j++;
    if (j - i >= MIN_ZERO_RUN) lost += j - i;
    i = j;
  }
  return { beforeStartS: start / rate, lostS: lost / rate };
}

export interface SlotRecord extends AudioLoss {
  /** Slot start, "13:14:15". */
  slot: string;
  /** Samples that carried audio, from the sidecar. */
  filledSamples: number;
  /** The app's own flags: audio began late, or a hole after it began. */
  lateStart: boolean;
  gap: boolean;
}

/** True when the slot had all its audio from its start. */
export const complete = (r: AudioLoss) => r.beforeStartS < LOST_LIMIT_S && r.lostS < LOST_LIMIT_S;

/** Saves each slot ("13:14:15") through Save slot and reads its sidecar and audio. */
export async function slotRecords(page: Page, slots: string[]): Promise<SlotRecord[]> {
  await page.getByRole('button', { name: 'Save slot' }).click();
  const sheet = page.getByRole('dialog', { name: 'Save a slot' });
  await expect(sheet).toBeVisible();
  const out: SlotRecord[] = [];
  for (const slot of slots) {
    await sheet.getByRole('button', { name: new RegExp(`^Save the slot at ${slot} UTC`) }).click();
    // Files are named after the slot start, YYMMDD_HHMMSS.
    const stem = `_${slot.replaceAll(':', '')}`;
    const [wav] = await Promise.all([page.waitForEvent('download'), sheet.getByRole('link', { name: new RegExp(`${stem}\\.wav$`) }).click()]);
    const [json] = await Promise.all([page.waitForEvent('download'), sheet.getByRole('link', { name: new RegExp(`${stem}\\.json$`) }).click()]);
    const sidecar = JSON.parse(readFileSync((await json.path())!, 'utf8')) as { capture: { filled_samples: number; late_start: boolean; gap: boolean } };
    const audio = decodeWav16(readFileSync((await wav.path())!));
    out.push({ slot, filledSamples: sidecar.capture.filled_samples, lateStart: sidecar.capture.late_start, gap: sidecar.capture.gap, ...audioLoss(audio.samples, audio.sampleRate) });
  }
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  return out;
}
