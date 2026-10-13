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

  // The QSO ends with 73 sent and logged; then the dock is idle again.
  await expect(dock.getByRole('button', { name: 'Call CQ' })).toBeVisible({ timeout: 150_000 });
  const sent = await waitForTransmissions(page, 3, 1000);
  const wasm = (await loadWasm())!;
  const report = row(`9V1NE ${DX.call} -12`);
  const snr = Number((await report.locator('.c-db').textContent())!.replace('−', '-'));
  const rpt = `${snr < 0 ? '-' : '+'}${String(Math.abs(snr)).padStart(2, '0')}`;
  const summary = sent.map((t) => ({ text: decodeCaptured(wasm, t).map((d) => d.text).join(' | '), startErrorMs: Math.round(startError(t) * 10) / 10, slot: new Date(slotOf(t)).toISOString().slice(11, 19) }));
  test.info().annotations.push({ type: 'qso', description: JSON.stringify({ tapAfterSlotMs: tappedAt - slotOf(sent[0]), summary }) });

  // Tx1, Tx3, Tx5. On a loaded machine the decode of their reply can come after our next slot
  // has started; the message then goes out once more and the next one follows a slot later.
  const order = summary.map((s) => s.text).filter((t, i, all) => i === 0 || t !== all[i - 1]);
  expect(order).toEqual([`${DX.call} 9V1NE OJ11`, `${DX.call} 9V1NE R${rpt}`, `${DX.call} 9V1NE 73`]);
  expect(sent.length).toBeLessThanOrEqual(4);
  // Tx1 may start late, by up to 1.5 s, when the tap comes after slot + 0.3 s; the rest are
  // decided before their slot and go out on time.
  expect(startError(sent[0])).toBeGreaterThanOrEqual(-50);
  expect(startError(sent[0])).toBeLessThanOrEqual(1550);
  for (const t of sent.slice(1)) expect(Math.abs(startError(t))).toBeLessThanOrEqual(50);
  // One parity: our slots are 2 apart.
  for (let i = 1; i < sent.length; i++) expect(slotOf(sent[i]) - slotOf(sent[i - 1])).toBe(2 * SLOT_MS);

  const notice = page.getByRole('status').filter({ hasText: `Logged ${DX.call}` });
  await expect(notice).toContainText(`Logged ${DX.call} 20m FT8 −${rpt.slice(1)} / −12`);
  await expect(notice.getByRole('button', { name: 'Undo' })).toBeVisible();
  // What we sent shows in the list as amber rows.
  for (const t of [`${DX.call} 9V1NE OJ11`, `${DX.call} 9V1NE R${rpt}`, `${DX.call} 9V1NE 73`]) await expect(row(t)).toHaveClass(/k-sent/);
  // After 73 the QSO is over and Tx is off.
  await expect(dock.getByRole('button', { name: 'Call CQ' })).toBeVisible();
});
