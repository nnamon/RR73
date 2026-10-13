// A QSO end to end in Chromium. The fake microphone plays the other station (qso-script.ts):
// CQ, then a report, then RR73, one slot each with our slots silent. The app's output is recorded
// in the page (tap.ts) and decoded in Node with the app's own wasm decoder. The QSO lands in the
// Log, waits for a mock Wavelog (route interception; no real server) and goes on Send now.
import { expect, test } from '@playwright/test';
import { captured, decodeCaptured, slotOf, SLOT_MS, type Captured } from './tap';
import { loadWasm } from './wasm';
import { DX } from './qso-script';
import { prepare, startAudioAtBoundary, startError } from './txhelp';
import { mockWavelog, seed, wavelogOnly } from './log-data';

test('a QSO from a double-tap on a CQ: Tx1, Tx3 and Tx5 on time, logged and sent to Wavelog', async ({ page }) => {
  test.setTimeout(300_000);
  const wavelog = await mockWavelog(page);
  // Wavelog set up, sending by hand, so the QSO stays waiting until Send now.
  const dock = await prepare(page, (p) => seed(p, wavelogOnly({ sendAutomatically: false })));
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
  let rpt = '';

  const wasm = (await loadWasm())!;
  const textOf = (t: Captured) => decodeCaptured(wasm, t).map((d) => d.text).join(' | ');
  // Whatever happens, the transmissions so far go into the report.
  const describe = async () => {
    try {
      const all = await captured(page);
      return all.map((t) => ({ text: textOf(t), startErrorMs: Math.round(startError(t) * 10) / 10, slot: new Date(slotOf(t)).toISOString().slice(11, 19) }));
    } catch (e) {
      return String(e);
    }
  };
  try {
    // Logged when their RR73 is decoded: the log's notice shows for 10 s.
    const notice = page.getByRole('status').filter({ hasText: `Logged ${DX.call}` });
    await expect(notice).toBeVisible({ timeout: 150_000 });
    const report = row(`9V1NE ${DX.call} -12`);
    const snr = Number((await report.locator('.c-db').textContent())!.replace('−', '-'));
    rpt = `${snr < 0 ? '-' : '+'}${String(Math.abs(snr)).padStart(2, '0')}`;
    await expect(notice).toContainText(`Logged ${DX.call} 20m FT8 −${rpt.slice(1)} / −12`);
    await expect(notice.getByRole('button', { name: `Undo the QSO with ${DX.call}` })).toBeVisible();
    // Then 73 goes out, and the QSO is over.
    await expect.poll(async () => { const t = (await captured(page)).at(-1); return t ? textOf(t) : ''; }, { timeout: 40_000, intervals: [1000] }).toBe(`${DX.call} 9V1NE 73`);
    await expect(dock.getByRole('button', { name: 'Call CQ' })).toBeVisible();
  } finally {
    test.info().annotations.push({ type: 'qso', description: JSON.stringify({ tappedAt: new Date(tappedAt).toISOString().slice(11, 23), sent: await describe() }) });
  }
  const sent = await captured(page);
  const summary = sent.map((t) => ({ text: textOf(t) }));

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

  // What we sent shows in the list as amber rows.
  for (const t of [`${DX.call} 9V1NE OJ11`, `${DX.call} 9V1NE R${rpt}`, `${DX.call} 9V1NE 73`]) await expect(row(t)).toHaveClass(/k-sent/);
  // In the Log with the band, grid and reports, waiting for Wavelog.
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Log' }).click();
  const entry = page.locator('li.lr', { has: page.getByText(DX.call, { exact: true }) });
  await expect(entry).toHaveCount(1);
  await expect(entry).toContainText(`20m FT8 · 14.076 · ${DX.grid} · −${rpt.slice(1)} / −12`);
  await expect(entry).toContainText('Wavelog · waiting');
  expect(wavelog.requests.filter((r) => r.path === '/api/qso')).toHaveLength(0);
  await page.locator('label.seg-i', { hasText: 'To do' }).click();
  await page.getByRole('button', { name: 'Send now' }).click();
  await expect(page.getByText('Nothing to do')).toBeVisible();
  const posted = wavelog.requests.filter((r) => r.path === '/api/qso');
  expect(posted).toHaveLength(1);
  const adif = String(posted[0].body?.string);
  for (const field of [`<CALL:6>${DX.call}`, '<MODE:3>FT8', '<BAND:3>20m', `<RST_SENT:3>${rpt}`, '<RST_RCVD:3>-12', `<GRIDSQUARE:4>${DX.grid}`, '<FREQ:9>14.075500', '<STATION_CALLSIGN:5>9V1NE']) {
    expect(adif).toContain(field);
  }
});
