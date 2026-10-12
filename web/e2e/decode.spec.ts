// Decoding in the app: Chromium's fake microphone plays one synthetic FT8 slot with 4 known
// messages (e2e/fixtures/ft8-four-signals.json), looped. Audio starts 0.2 s before a UTC slot
// boundary, so each loop lands inside one slot with a DT the decoder accepts.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

interface Truth {
  text: string;
  freq_hz: number;
  dt_s: number;
  snr_db: number;
}

const TRUTH = (JSON.parse(readFileSync(new URL('./fixtures/ft8-four-signals.json', import.meta.url), 'utf8')) as { truth: Truth[] }).truth;
const MY_CALL = '9V1NE';

async function setCallsign(page: Page) {
  await page.goto('./#/settings');
  const field = page.getByRole('textbox', { name: 'Callsign' });
  await field.fill(MY_CALL);
  await field.press('Enter');
  await expect(field).toHaveValue(MY_CALL);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Operate' }).click();
}

/** Records the wall-clock time each slot header first appears. */
async function watchHeaders(page: Page) {
  await page.evaluate(() => {
    const seen: Record<string, number> = {};
    (window as unknown as { __heads: Record<string, number> }).__heads = seen;
    new MutationObserver(() => {
      for (const h of document.querySelectorAll('.slot-head')) {
        const t = h.textContent ?? '';
        if (!(t in seen)) seen[t] = Date.now();
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
}

/** Taps Start audio 0.2 s before the next slot boundary. */
async function startAtSlotBoundary(page: Page) {
  const wait = (14800 - (Date.now() % 15000) + 15000) % 15000;
  await page.waitForTimeout(wait);
  await page.getByRole('button', { name: 'Start audio' }).click();
}

test('decodes a real FT8 slot into the list, marked as in WSJT-X', async ({ page }) => {
  test.setTimeout(120_000);
  const loadLog: string[] = [];
  page.on('console', (m) => {
    if (/decoder .* loaded in/.test(m.text())) loadLog.push(m.text());
  });
  await setCallsign(page);
  await watchHeaders(page);
  await startAtSlotBoundary(page);
  await expect(page.getByText('Receiving')).toBeVisible({ timeout: 10_000 });

  // The first full slot ends within 15.2 s; allow a second slot in case the first starts late.
  const list = page.getByTestId('decode-list');
  const row = (text: string) => list.locator('li.dr', { has: page.locator('.c-msg', { hasText: new RegExp(`^${text}$`) }) }).first();
  await expect(row(TRUTH[0].text)).toBeVisible({ timeout: 45_000 });
  for (const t of TRUTH) await expect(row(t.text), t.text).toBeVisible();

  // Each row: frequency within 3 Hz and SNR within 4 dB of what was transmitted.
  for (const t of TRUTH) {
    const r = row(t.text);
    const hz = Number(await r.locator('.c-hz').textContent());
    const snr = Number((await r.locator('.c-db').textContent())!.replace('\u2212', '-'));
    expect(Math.abs(hz - t.freq_hz), `${t.text} frequency ${hz} Hz`).toBeLessThanOrEqual(3);
    expect(Math.abs(snr - t.snr_db), `${t.text} SNR ${snr} dB`).toBeLessThanOrEqual(4);
  }

  // WSJT-X marking: CQ calls green, the message with my callsign red, the rest plain; the other
  // station's callsign in bold.
  await expect(row('CQ 9M2TRX OJ02')).toHaveClass(/k-cq/);
  await expect(row('CQ VK3QRP QF22')).toHaveClass(/k-cq/);
  await expect(row('9V1NE JA1KXM PM95')).toHaveClass(/k-me/);
  await expect(row('9V1NE JA1KXM PM95').locator('.c-msg b')).toHaveText('JA1KXM');
  await expect(row('JH1RRT YB0AZK RR73')).not.toHaveClass(/k-(cq|me)/);
  await expect(page.getByRole('listitem', { name: /9V1NE JA1KXM PM95, to you/ })).toBeVisible();

  // Rows are 40 px, and the list with decodes passes axe (WCAG 2.2 AA).
  for (const t of TRUTH) expect((await row(t.text).boundingBox())!.height).toBeCloseTo(40, 0);
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
  await page.screenshot({ path: fileURLToPath(new URL('../test-results/screens/decode-chromium-light-operate.png', import.meta.url)) });

  // The slot header: "13:14:15 UTC · 4 decodes · decoded in 0.38 s".
  const head = list.locator('.slot-head').first();
  await expect(head).toHaveText(/^\d\d:\d\d:(00|15|30|45) UTC · \d+ decodes? · decoded in \d+\.\d\d s$/);

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

test('the list stays still under a finger and takes new slots after it lifts', async ({ page }) => {
  test.setTimeout(120_000);
  await setCallsign(page);
  await startAtSlotBoundary(page);
  const list = page.getByTestId('decode-list');
  const heads = list.locator('.slot-head');
  await expect(heads.first()).toBeVisible({ timeout: 45_000 });
  const firstSlot = (await heads.first().textContent())!.slice(0, 8);

  // Hold a finger on the list across the next slot's decode.
  const box = (await list.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 60);
  await page.mouse.down();
  const held = Date.now();
  await page.waitForTimeout(17_000);
  expect((await heads.first().textContent())!.slice(0, 8)).toBe(firstSlot);
  await page.mouse.up();
  // Free again 0.5 s after the finger lifts: the newer slot goes in on top.
  await expect.poll(async () => (await heads.first().textContent())!.slice(0, 8), { timeout: 3000 }).not.toBe(firstSlot);
  expect(Date.now() - held).toBeGreaterThan(17_000);
});

test('without the decoder module, the list says so and receive carries on', async ({ page }) => {
  await page.route('**/*.wasm', (r) => r.abort());
  await page.goto('./');
  await page.getByRole('button', { name: 'Start audio' }).click();
  await expect(page.getByText('Receiving')).toBeVisible({ timeout: 10_000 });
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('No decodes: the decoder did not load', { timeout: 15_000 });
  await expect(alert).toContainText('Receive still works');
  await expect(page.getByRole('meter', { name: 'Input level' })).toHaveAttribute('aria-valuetext', /dBFS$/);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByTestId('decoder-status')).toHaveText('Did not load');
});
