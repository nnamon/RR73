// Decoding in the app: Chromium's fake microphone plays e2e/fixtures/ft8-loop.wav, a 15 s loop
// that holds 4 known messages 4 times each, 3.75 s and 90 Hz apart (written by
// `rr73-bench loop-fixture`, docs/bench.md). Chromium starts the loop when capture starts, at an
// offset to the UTC slots that a loaded host moves by seconds and that drifts from slot to slot.
// Whatever the offset, a slot with all its audio holds one copy of each message at a DT the
// decoder accepts.
//
// A loaded host also starves the fake microphone: audio goes missing inside a slot, and the
// missing stretch comes back as zeros, which cuts every transmission in that slot. The test
// reads the app's record of each slot it judges (slot-record.ts). When every judged slot lost
// audio, its decodes say nothing about the app: under GitHub Actions the test fails, elsewhere it
// is skipped with the audio lost and the load average. A slot with all its audio that misses a
// message fails everywhere. docs/testing.md has the measurements; on a loaded host, run this file
// alone.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { fileURLToPath } from 'node:url';
import { LOST_LIMIT_S, audioLoss, complete, slotRecords } from './slot-record';

interface Truth {
  text: string;
  freq_hz: number;
  dt_s: number;
  snr_db: number;
}

/** Every copy in the loop, with its DT from the start of the file. */
const TRUTH = (JSON.parse(readFileSync(new URL('./fixtures/ft8-loop.json', import.meta.url), 'utf8')) as { truth: Truth[] }).truth;
/** The 4 messages, each with its copies. */
const MESSAGES = [...new Set(TRUTH.map((t) => t.text))].map((text) => ({ text, copies: TRUTH.filter((t) => t.text === text) }));
const MY_CALL = '9V1NE';
/** A decode counts as a copy within these limits of its frequency and SNR. */
const FREQ_LIMIT_HZ = 3;
const SNR_LIMIT_DB = 4;
/** Time allowed after a slot ends for its decodes to appear on a loaded host, ms. */
const DECODE_ALLOWANCE_MS = 10_000;

/**
 * When in the UTC slot the tests tap Start audio, ms. The default, 0.2 s before a boundary,
 * makes the first slot that decodes a full one. RR73_E2E_TAP_AT_MS moves the tap, for example
 * to 3000 (3 s past a boundary), to show the decodes do not depend on it.
 */
const TAP_AT_MS = Number(process.env.RR73_E2E_TAP_AT_MS ?? 14_800);
if (!Number.isInteger(TAP_AT_MS) || TAP_AT_MS < 0 || TAP_AT_MS >= 15_000) throw new Error(`RR73_E2E_TAP_AT_MS must be 0 to 14999, not ${process.env.RR73_E2E_TAP_AT_MS}`);

async function setCallsign(page: Page) {
  await page.goto('./#/settings');
  const field = page.getByRole('textbox', { name: 'Callsign' });
  await field.fill(MY_CALL);
  await field.press('Enter');
  await expect(field).toHaveValue(MY_CALL);
  await page.getByRole('link', { name: 'Operate' }).click();
}

/** Records the wall-clock time each slot header first appears. */
async function watchHeaders(page: Page) {
  await page.evaluate(() => {
    const seen: Record<string, number> = {};
    (window as unknown as { __heads: Record<string, number> }).__heads = seen;
    new MutationObserver(() => {
      for (const h of document.querySelectorAll<HTMLElement>('.slot-bar[data-ms]')) {
        const t = `${h.querySelector('.visually-hidden')?.textContent ?? ''} · decoded in ${(Number(h.dataset.ms) / 1000).toFixed(2)} s`;
        if (!(t in seen)) seen[t] = Date.now();
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
}

/** Taps Start audio TAP_AT_MS into a UTC slot and returns the end of that slot, UTC ms. */
async function tapStartAudio(page: Page): Promise<number> {
  const wait = (TAP_AT_MS - (Date.now() % 15_000) + 15_000) % 15_000;
  await page.waitForTimeout(wait);
  const slotEnd = Date.now() - (Date.now() % 15_000) + 15_000;
  await page.getByRole('button', { name: 'Start audio' }).click();
  return slotEnd;
}

interface ListedSlot {
  head: string;
  /** False for a slot listed before the decoder answered for it. */
  decoded: boolean;
  rows: { text: string; hz: number; db: number }[];
}

/**
 * The slots one bar stands for, newest first, each head starting with the slot's start as Save
 * slot names it. Since 0.10.4 a run of decoded slots with no decodes shares one bar, "23:59:45 to
 * 00:00:15 UTC · no decodes" (lib/decode/list.ts): one entry for each of its slots.
 */
function slotsOfBar(text: string, ms: string | null): ListedSlot[] {
  const run = /^(\d\d):(\d\d):(\d\d) to (\d\d):(\d\d):(\d\d) UTC · no decodes$/.exec(text);
  if (!run) return [{ head: `${text}${ms ? ` · decoded in ${(Number(ms) / 1000).toFixed(2)} s` : ''}`, decoded: !!ms, rows: [] }];
  const sec = (h: string, m: string, s: string) => Number(h) * 3600 + Number(m) * 60 + Number(s);
  const from = sec(run[1], run[2], run[3]);
  const span = (sec(run[4], run[5], run[6]) - from + 86_400) % 86_400;
  const out: ListedSlot[] = [];
  for (let t = span; t >= 0; t -= 15) {
    const at = (from + t) % 86_400;
    const hms = [Math.floor(at / 3600), Math.floor(at / 60) % 60, at % 60].map((n) => String(n).padStart(2, '0')).join(':');
    out.push({ head: `${hms} UTC · no decodes, in a run`, decoded: true, rows: [] });
  }
  return out;
}

/** The slots in the decode list, oldest first, each with its rows as shown. */
async function listedSlots(page: Page): Promise<ListedSlot[]> {
  const items = await page.getByTestId('decode-list').evaluate((list) => {
    const out: ({ bar: string; ms: string | null } | { text: string; hz: number; db: number })[] = [];
    for (const li of list.querySelectorAll('li')) {
      const cell = (c: string) => li.querySelector(c)?.textContent ?? '';
      if (li.classList.contains('slot-bar')) out.push({ bar: cell('.visually-hidden'), ms: li.dataset.ms ?? null });
      else if (li.querySelector('button.dr')) out.push({ text: cell('.c-msg'), hz: parseInt(cell('.c-hz')), db: parseInt(cell('.c-db').replace('\u2212', '-')) });
    }
    return out;
  });
  const slots: ListedSlot[] = [];
  for (const it of items) {
    if ('bar' in it) slots.push(...slotsOfBar(it.bar, it.ms));
    else if (slots.length) slots[slots.length - 1].rows.push(it);
  }
  return slots.reverse();
}

/** The slots the test judges: the first two the app decoded. */
const judged = (slots: ListedSlot[]) => slots.filter((s) => s.decoded).slice(0, 2);

/**
 * For each message, the first row in the judged slots that has its text, with frequency within
 * 3 Hz and SNR within 4 dB of one of its copies, or null.
 */
function findCopies(slots: ListedSlot[]) {
  const rows = judged(slots).flatMap((s) => s.rows.map((r) => ({ slot: s.head.slice(0, 8), ...r })));
  return MESSAGES.map(({ text, copies }) => {
    const row = rows.find((r) => r.text === text && copies.some((c) => Math.abs(r.hz - c.freq_hz) <= FREQ_LIMIT_HZ && Math.abs(r.db - c.snr_db) <= SNR_LIMIT_DB));
    return { text, row: row ?? null };
  });
}

/**
 * Lost audio fails the test under GitHub Actions and skips it elsewhere. docker-compose.yml sets
 * CI=1 for local runs too, so CI does not tell them apart.
 */
const STRICT_AUDIO = process.env.GITHUB_ACTIONS === 'true';

// The measure of lost audio the test judges slots by; slot-record.spec.ts (RR73_REVIEW=1) checks
// it against a slot played with 1 s of silence.
test('zero runs of 2 ms or more count as lost audio, and silence at the start as a late start', () => {
  const x = new Float32Array(12_000).fill(0.01);
  x.fill(0, 0, 600); // 0.05 s before audio began
  x.fill(0, 3000, 3023); // 23 samples: below 2 ms, not counted
  x.fill(0, 6000, 7200); // 0.1 s lost
  const loss = audioLoss(x);
  expect(loss.beforeStartS).toBeCloseTo(0.05, 6);
  expect(loss.lostS).toBeCloseTo(0.1, 6);
  expect(complete(loss)).toBe(false);
  expect(complete({ beforeStartS: 0.05, lostS: 0.099 })).toBe(true);
  expect(complete({ beforeStartS: 0.1, lostS: 0 })).toBe(false);
});

// A run of empty slots on one bar counts as each of its slots, so a starved host, whose slots
// decode nothing, still has 2 slots to judge and skips the test. In 0.10.4 the run hid them.
test('a bar for a run of empty slots stands for each of its slots', () => {
  const run = slotsOfBar('23:59:45 to 00:00:15 UTC · no decodes', null);
  expect(run.map((s) => [s.head.slice(0, 8), s.decoded])).toEqual([
    ['00:00:15', true],
    ['00:00:00', true],
    ['23:59:45', true],
  ]);
  expect(slotsOfBar('13:14:15 UTC · 4 decodes, odd slot', '820')).toEqual([{ head: '13:14:15 UTC · 4 decodes, odd slot · decoded in 0.82 s', decoded: true, rows: [] }]);
  expect(slotsOfBar('13:14:30 UTC · not decoded: the decoder was busy', null)[0].decoded).toBe(false);
});

test('decodes a real FT8 slot into the list, marked as in WSJT-X', async ({ page }) => {
  test.setTimeout(150_000);
  const loadLog: string[] = [];
  page.on('console', (m) => {
    if (/decoder .* loaded in/.test(m.text())) loadLog.push(m.text());
  });
  await setCallsign(page);
  await watchHeaders(page);
  const slotEnd = await tapStartAudio(page);
  await expect(page.getByRole('timer', { name: /Receiving$/ })).toBeVisible({ timeout: 10_000 });

  // Each message decodes from at least one copy within the first two decoded slots. The slot of
  // the tap counts when it holds half a slot of audio or more.
  const deadline = slotEnd + 30_000 + DECODE_ALLOWANCE_MS;
  let slots = await listedSlots(page);
  while (findCopies(slots).some((f) => !f.row) && Date.now() < deadline) {
    await page.waitForTimeout(500);
    slots = await listedSlots(page);
  }
  const found = findCopies(slots);
  const missing = found.filter((f) => !f.row).map((f) => f.text);
  const records = await slotRecords(page, judged(slots).map((s) => s.head.slice(0, 8)));
  test.info().annotations.push({ type: 'decodes', description: JSON.stringify({ tapAtMs: TAP_AT_MS, found, records, slots }) });
  let message = `messages without a copy within ${FREQ_LIMIT_HZ} Hz and ${SNR_LIMIT_DB} dB in the first two decoded slots`;
  if (missing.length && records.length === 2 && !records.some(complete)) {
    const lost = records
      .map((r) => `${r.lostS.toFixed(2)} s lost in ${r.slot} UTC${r.beforeStartS >= LOST_LIMIT_S ? ` (audio from ${r.beforeStartS.toFixed(2)} s)` : ''}`)
      .join(', ');
    message = `Host overloaded: ${lost}, load ${loadavg().map((l) => l.toFixed(1)).join(' ')}. decode.spec needs real-time audio.`;
    test.info().annotations.push({ type: 'lost audio', description: message });
    test.skip(!STRICT_AUDIO, message);
  }
  expect(missing, message).toEqual([]);

  // WSJT-X marking: CQ calls green, the message with my callsign red, the rest plain; the other
  // station's callsign in bold.
  const list = page.getByTestId('decode-list');
  const row = (text: string) => list.locator('button.dr', { has: page.locator('.c-msg', { hasText: new RegExp(`^${text}$`) }) }).first();
  await expect(row('CQ 9M2TRX OJ02')).toHaveClass(/k-cq/);
  await expect(row('CQ VK3QRP QF22')).toHaveClass(/k-cq/);
  await expect(row('9V1NE JA1KXM PM95')).toHaveClass(/k-me/);
  await expect(row('9V1NE JA1KXM PM95').locator('.c-msg b')).toHaveText('JA1KXM');
  await expect(row('JH1RRT YB0AZK RR73')).not.toHaveClass(/k-(cq|me)/);
  await expect(page.getByRole('button', { name: /9V1NE JA1KXM PM95, to you/ }).first()).toBeVisible();

  // Rows are 32 px, and the list with decodes passes axe (WCAG 2.2 AA).
  for (const { text } of MESSAGES) expect((await row(text).boundingBox())!.height).toBeCloseTo(32, 0);
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
  await page.screenshot({ path: fileURLToPath(new URL('../test-results/screens/decode-chromium-light-operate.png', import.meta.url)) });

  // The slot bar: "13:14:15", "4 decodes" and Even or Odd; screen readers hear "13:14:15 UTC · 4 decodes, odd slot".
  const head = list.locator('.slot-bar[data-ms]').first();
  await expect(head.locator('.visually-hidden')).toHaveText(/^\d\d:\d\d:(00|15|30|45) UTC · \d+ decodes?, (even|odd) slot$/);
  await expect(head.locator('.par')).toHaveText(/^(Even|Odd)$/);

  // Measurements for the report and the changelog: time from slot end to the header, decode
  // time, and the decoder's load time.
  const heads = await page.evaluate(() => (window as unknown as { __heads: Record<string, number> }).__heads);
  const today = new Date();
  const timings = Object.entries(heads)
    .filter(([t]) => / decoded in /.test(t))
    .map(([t, shownAt]) => {
      const [h, m, s] = t.slice(0, 8).split(':').map(Number);
      const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), h, m, s);
      return { slot: t.slice(0, 8), decodes: Number(/· (\d+) decode/.exec(t)?.[1]), decodeS: Number(/decoded in ([\d.]+) s/.exec(t)?.[1]), afterSlotEndS: (shownAt - start - 15000) / 1000 };
    });
  test.info().annotations.push({ type: 'timing', description: JSON.stringify({ timings, load: loadLog }) });
  expect(timings.length).toBeGreaterThan(0);
  for (const t of timings) expect(t.afterSlotEndS).toBeLessThan(3);
  expect(loadLog).toHaveLength(1);
});

test('without the decoder module, the list says so and receive carries on', async ({ page }) => {
  await page.route('**/*.wasm', (r) => r.abort());
  await page.goto('./');
  await page.getByRole('button', { name: 'Start audio' }).click();
  await expect(page.getByRole('timer', { name: /Receiving$/ })).toBeVisible({ timeout: 10_000 });
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('No decodes: the decoder did not load', { timeout: 15_000 });
  await expect(alert).toContainText('The waterfall and Save slot still work');
  await expect(page.getByRole('meter', { name: 'Input level' })).toHaveAttribute('aria-valuetext', /dBFS$/);
  await page.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('link', { name: /^Radio and audio/ }).click();
  await expect(page.getByTestId('decoder-status')).toHaveText('Did not load');
});
