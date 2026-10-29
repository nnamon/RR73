// LQ8 end to end in Chromium on the practice band (docs/design/lq8.md): the band is synthesised
// in the page in LQ8, decoded by the app's decoder in real time, and worked with LQ8's 4-message
// QSO in both directions. Every test fails if a request leaves the phone.
import { expect, test, type Page } from '@playwright/test';
import { loadWasm } from './wasm';

const ME = '9V1NE';
let escaped: string[] = [];

test.beforeEach(async ({ page, baseURL }) => {
  test.skip(!(await loadWasm()), 'The wasm package is not built (src/wasm/pkg).');
  escaped = [];
  const origin = new URL(baseURL!).origin;
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.protocol === 'data:' || u.protocol === 'blob:') return;
    if (u.origin !== origin || (r.method() !== 'GET' && r.method() !== 'HEAD')) escaped.push(`${r.method()} ${r.url()}`);
  });
  await page.route((url) => url.origin !== origin, (route) => route.abort());
});

test.afterEach(() => {
  expect(escaped, 'requests that left the phone').toEqual([]);
});

/** Callsign and grid set, the practice band on, then LQ8 on 20m from the band sheet. */
async function lq8Practice(page: Page) {
  await page.goto('./#/settings');
  for (const [name, value] of [
    ['Callsign', ME],
    ['Grid', 'OJ11'],
  ]) {
    const field = page.getByRole('textbox', { name });
    await field.fill(value);
    await field.press('Enter');
  }
  await page.getByRole('link', { name: /^Practice band/ }).click();
  await page.getByRole('switch', { name: /^Practice band/ }).check();
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('link', { name: 'Operate' }).click();
  await page.getByRole('button', { name: /^Change band/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Change band' });
  await sheet.getByText('LQ8', { exact: true }).click();
  await expect(sheet.getByTestId('ft-dial')).toHaveValue('14.084');
  // LQ8 has no Hound.
  await expect(sheet.getByRole('switch', { name: 'Hound' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('timer', { name: /Receiving$/ })).toBeVisible({ timeout: 10_000 });
}

async function scenario(page: Page, name: string) {
  const bar = page.getByRole('region', { name: 'Transmit' });
  await bar.getByRole('button', { name: 'More' }).click();
  const menu = page.getByRole('menu', { name: 'More' });
  // Hound is FT8 only.
  await expect(menu.getByRole('menuitemcheckbox', { name: /^Hound/ })).toHaveCount(0);
  await menu.getByRole('menuitem', { name: /^Practice scenario/ }).click();
  const list = page.getByRole('radiogroup', { name: 'Practice scenario' });
  // Contest exchanges and the Fox are FT8 and FT4 scenarios.
  await expect(list.getByRole('radio', { name: 'Contest exchanges' })).toHaveCount(0);
  await expect(list.getByRole('radio', { name: 'Fox (DXpedition)' })).toHaveCount(0);
  await list.getByRole('radio', { name, exact: true }).click();
  await expect(bar.getByRole('status')).toContainText(`Practice · ${name}`);
}

const rows = (page: Page) => page.getByTestId('decode-list').locator('button.dr');
const row = (page: Page, text: RegExp) => rows(page).filter({ has: page.locator('.c-msg', { hasText: text }) });

/** The practice log's QSOs as stored: callsign, MODE and SUBMODE. */
async function practiceLog(page: Page): Promise<{ call: string; mode: string; submode: string; freqHz: number | null }[]> {
  return page.evaluate(async () => {
    const d = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('rr73-practice');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const all = await new Promise<{ call: string; mode: string; submode: string; freqHz: number | null; deletedAt: number | null }[]>((resolve) => {
      const g = d.transaction('qsos').objectStore('qsos').getAll();
      g.onsuccess = () => resolve(g.result as never);
    });
    d.close();
    return all.filter((q) => q.deletedAt === null).map(({ call, mode, submode, freqHz }) => ({ call, mode, submode, freqHz }));
  });
}

test('calling CQ in LQ8: a caller sends grid and report, gets REPORT+73, ends with 73, and the QSO logs as DATA LQ8', async ({ page }) => {
  test.setTimeout(240_000);
  await lq8Practice(page);
  await scenario(page, 'One caller');
  const bar = page.getByRole('region', { name: 'Transmit' });
  await bar.getByRole('button', { name: 'CQ' }).click();

  // LQ8's call: their grid and report in one message.
  const caller = row(page, new RegExp(`^${ME} [A-Z0-9]+ [A-R]{2}\\d{2} [-+]\\d\\d$`)).first();
  await expect(caller).toBeVisible({ timeout: 90_000 });
  const call = (await caller.locator('.c-msg').textContent())!.split(' ')[1];
  // Our REPORT+73 goes out in the next slot, then their 73 logs the QSO.
  await expect(bar.getByText(new RegExp(`${call} ${ME} R[-+]\\d\\d`))).toBeVisible({ timeout: 40_000 });
  await expect(row(page, new RegExp(`^${ME} ${call} 73$`)).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('status').filter({ hasText: `Logged ${call}` })).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => practiceLog(page)).toEqual([{ call, mode: 'DATA', submode: 'LQ8', freqHz: expect.any(Number) }]);
  const [q] = await practiceLog(page);
  expect(q.freqHz! - 14_084_000).toBeGreaterThan(0);
  expect(q.freqHz! - 14_084_000).toBeLessThan(3000);

  await page.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Log' }).click();
  await expect(page.locator('li.lr').first()).toContainText(call);
  await expect(page.locator('li.lr').first()).toContainText('LQ8');
});

test('answering a CQ in LQ8: our call with grid and report, their REPORT+73 logs the QSO, and our 73 ends it', async ({ page }) => {
  test.setTimeout(240_000);
  await lq8Practice(page);
  await scenario(page, 'Station answers');
  const cq = row(page, /^CQ [A-Z0-9]+ [A-R]{2}\d{2}$/).first();
  await expect(cq).toBeVisible({ timeout: 60_000 });
  const call = (await cq.locator('.c-msg').textContent())!.split(' ')[1];
  await cq.dblclick();
  const bar = page.getByRole('region', { name: 'Transmit' });
  await expect(bar.getByText(new RegExp(`${call} ${ME} OJ11 [-+]\\d\\d`))).toBeVisible({ timeout: 10_000 });
  // Their REPORT+73 to us.
  await expect(row(page, new RegExp(`^${ME} ${call} R[-+]\\d\\d$`)).first()).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole('status').filter({ hasText: `Logged ${call}` })).toBeVisible({ timeout: 20_000 });
  await expect(bar.getByText(new RegExp(`${call} ${ME} 73`))).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => practiceLog(page).then((l) => l.map((x) => [x.call, x.mode, x.submode]))).toEqual([[call, 'DATA', 'LQ8']]);
});

test('Settings › FT8 and FT4 hides what LQ8 lacks, and the messages sheet lists LQ8’s 4', async ({ page }) => {
  await lq8Practice(page);
  await page.getByRole('region', { name: 'Transmit' }).getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Edit messages' }).click();
  const sheet = page.getByRole('dialog', { name: 'Messages' });
  await expect(sheet.getByRole('radio')).toHaveCount(4);
  await expect(sheet.getByRole('textbox', { name: 'Tx 6 text' })).toHaveValue(`CQ ${ME} OJ11`);
  // Free text packs as LQ8 free text; text longer than one message is refused.
  const tx6 = sheet.getByRole('textbox', { name: 'Tx 6 text' });
  await tx6.fill('TNX FER QSO');
  await tx6.press('Enter');
  await expect(tx6).toHaveValue('TNX FER QSO');
  await tx6.fill('TNX FER THE NICE QSO 73');
  await tx6.press('Enter');
  await expect(sheet.getByRole('alert')).toContainText('Cannot be sent: free text holds');
  await page.keyboard.press('Escape');

  // A band without an LQ8 dial takes FT8, as FT4 does on 160m.
  await page.getByRole('button', { name: /^Change band/ }).click();
  const sheet2 = page.getByRole('dialog', { name: 'Change band' });
  await expect(sheet2.getByRole('radio', { name: 'LQ8' })).toBeChecked();
  await sheet2.getByText('80m', { exact: true }).click();
  await page.getByRole('button', { name: /^Change band/ }).click();
  await expect(sheet2.getByRole('radio', { name: 'FT8' })).toBeChecked();
  await expect(sheet2.getByRole('radio', { name: 'LQ8' })).toBeDisabled();
  await sheet2.getByText('20m', { exact: true }).click();
  await page.getByRole('button', { name: /^Change band/ }).click();
  await sheet2.getByText('LQ8', { exact: true }).click();
  await page.keyboard.press('Escape');

  await page.goto('./#/settings/ft8');
  await expect(page.getByText('LQ8 QSOs follow these settings too.')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Contest exchange' })).toHaveCount(0);
  await expect(page.getByText('Confirm with')).toHaveCount(0);
  await expect(page.getByRole('switch', { name: 'A priori decoding' })).toHaveCount(0);
});
