// A QSO end to end in Chromium. The fake microphone plays the other station (qso-script.ts):
// CQ, then a report, then RR73, one slot each with our slots silent. The app's output is recorded
// in the page (tap.ts) and decoded in Node with the app's own wasm decoder.
import { expect, test } from '@playwright/test';
import { decodeCaptured, slotOf, SLOT_MS } from './tap';
import { loadWasm } from './wasm';
import { DX } from './qso-script';
import { prepare, startAudioAtBoundary, startError, waitForTransmissions } from './txhelp';

test('a QSO from a double-tap on a CQ: Tx1, Tx3 and Tx5 on time, and the QSO is logged', async ({ page }) => {
  test.setTimeout(300_000);
  const dock = await prepare(page);
  await startAudioAtBoundary(page);
  const list = page.getByTestId('decode-list');
  const row = (text: string) => list.locator('button.dr', { has: page.locator('.c-msg', { hasText: new RegExp(`^${text}$`) }) }).first();

  // Their CQ, decoded after the first slot: double-tap it as soon as it shows. Should a busy
  // machine cost that decode, the script comes round again 90 s later.
  const cq = row(`CQ ${DX.call} ${DX.grid}`);
  await expect(cq).toBeVisible({ timeout: 115_000 });
  const tappedAt = await page.evaluate(() => Date.now());
  await cq.dblclick();
  await expect(dock.getByText(DX.call, { exact: true })).toBeVisible();

  const sent = await waitForTransmissions(page, 3, 110_000);
  const wasm = (await loadWasm())!;
  const report = row(`9V1NE ${DX.call} -12`);
  const snr = Number((await report.locator('.c-db').textContent())!.replace('−', '-'));
  const rpt = `${snr < 0 ? '-' : '+'}${String(Math.abs(snr)).padStart(2, '0')}`;
  const summary = sent.map((t) => ({ text: decodeCaptured(wasm, t).map((d) => d.text), startErrorMs: Math.round(startError(t) * 10) / 10, slot: new Date(slotOf(t)).toISOString().slice(11, 19) }));
  test.info().annotations.push({ type: 'qso', description: JSON.stringify({ tapAfterSlotMs: tappedAt - (slotOf(sent[0]) ), summary }) });

  expect(summary.map((s) => s.text)).toEqual([[`${DX.call} 9V1NE OJ11`], [`${DX.call} 9V1NE R${rpt}`], [`${DX.call} 9V1NE 73`]]);
  // Tx1 may start late, by up to 1.5 s, when the tap comes after slot + 0.3 s; Tx3 and Tx5 are
  // decided 0.1 s after the slot starts and go out on time.
  expect(startError(sent[0])).toBeGreaterThanOrEqual(-50);
  expect(startError(sent[0])).toBeLessThanOrEqual(1550);
  expect(Math.abs(startError(sent[1]))).toBeLessThanOrEqual(50);
  expect(Math.abs(startError(sent[2]))).toBeLessThanOrEqual(50);
  // One parity: our slots are 2 apart.
  expect(slotOf(sent[1]) - slotOf(sent[0])).toBe(2 * SLOT_MS);
  expect(slotOf(sent[2]) - slotOf(sent[1])).toBe(2 * SLOT_MS);

  const notice = page.getByRole('status').filter({ hasText: `Logged ${DX.call}` });
  await expect(notice).toContainText(`Logged ${DX.call} 20m FT8 −${rpt.slice(1)} / −12`);
  await expect(notice.getByRole('button', { name: 'Undo' })).toBeVisible();
  // What we sent shows in the list as amber rows.
  for (const t of [`${DX.call} 9V1NE OJ11`, `${DX.call} 9V1NE R${rpt}`, `${DX.call} 9V1NE 73`]) await expect(row(t)).toHaveClass(/k-sent/);
  // After 73 the QSO is over and Tx is off.
  await expect(dock.getByRole('button', { name: 'Call CQ' })).toBeVisible();
});
