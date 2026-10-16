// Rig control with the Elecraft KX2 end to end in Chromium (docs/design/cat.md, Elecraft KX2), with
// navigator.serial replaced by a fake KX2 behind a Digirig (fake-kx2.ts): choosing the radio,
// connecting with the lines lowered at once, the dial and the radio settings read, a band change
// setting VFO A and DATA A, the radio's dial followed, the baud rate, opening again after a reload,
// and Test keying with a radio that answers and one that keeps transmitting. The timed
// transmissions are in rig-kx2-tx.spec.ts.
import { expect, test } from '@playwright/test';
import { connectKx2, installFakeKx2, kx2Log, kx2Ptt } from './fake-kx2';

test('connects a KX2, lowers the lines at once, reads its dial and settings, and a band change sets VFO A and DATA A', async ({ page }) => {
  await installFakeKx2(page, { hz: 14_076_000 });
  await page.goto('./#/settings');
  await page.getByRole('link', { name: /Rig control/ }).click();
  // The IC-705 stays the default choice.
  await expect(page.getByRole('radio', { name: /Icom IC-705/ })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('radio', { name: /Elecraft KX2/ }).click();
  await expect(page.getByRole('radio', { name: /Elecraft KX2/ })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('combobox', { name: 'Baud rate' })).toHaveValue('4800');
  await expect(page.getByRole('switch', { name: /^Keep Tx audio centred/ })).toHaveCount(0);
  await expect(page.getByTestId('rig-help')).toHaveText('Plug in the Digirig by USB, tap Connect radio, then choose the Digirig’s CP210x serial port.');
  await page.getByRole('button', { name: 'Connect radio' }).click();
  await expect(page.getByTestId('rig-status')).toHaveText('Connected');
  await expect(page.getByTestId('rig-dial')).toHaveText('14.076 MHz USB');
  const state = await page.evaluate(() => ({ baud: window.__kx2.baud, dtr: window.__kx2.dtr, rts: window.__kx2.rts, transmit: window.__kx2.transmit }));
  expect(state).toEqual({ baud: 4800, dtr: false, rts: false, transmit: false });
  // The radio's MIC BTN read RTS as PTT from open() until the lines went low: once, and no TX or RX.
  expect(await page.evaluate(() => window.__kx2.lineKeyedAt.length)).toBe(1);
  expect(await kx2Ptt(page)).toEqual([]);
  await expect.poll(async () => (await kx2Log(page)).map((w) => w.text)).toContain('MN082;MP;MN255;');
  expect((await kx2Log(page))[0].text).toBe('TQ;');
  await expect(page.getByRole('listitem').filter({ hasText: 'Model' })).toContainText('KX2');
  await expect(page.getByRole('listitem').filter({ hasText: 'MIC BTN' })).toContainText('PTT UP.DN');
  await expect(page.getByRole('listitem').filter({ hasText: 'VOX' })).toContainText('Off');
  await expect(page.getByTestId('rig-advice').filter({ hasText: 'MIC BTN' })).toContainText('Set MENU › MIC BTN to OFF.');
  expect(await page.evaluate(() => window.__kx2.menu)).toBe(255);

  await page.evaluate(() => (location.hash = '#/'));
  const band = page.getByRole('button', { name: /^Change band/ });
  await expect(band).toContainText('14.076');
  await band.click();
  // Connecting changed nothing on the radio: it is still in USB.
  await expect(page.getByTestId('radio-line')).toHaveText('The KX2 is on 14.076 MHz USB. Choose the band to set DATA A.');
  const sheet = page.getByRole('dialog', { name: 'Change band' });
  await expect(sheet.getByText('The dial comes from the KX2. Saved slots and QSOs record it.')).toBeVisible();
  const before = (await kx2Log(page)).length;
  await sheet.getByText('40m', { exact: true }).click();
  await expect.poll(() => page.evaluate(() => [window.__kx2.hz, window.__kx2.mode, window.__kx2.sub])).toEqual([7_074_000, 6, 0]);
  const sets = (await kx2Log(page)).slice(before).map((w) => w.text).filter((t) => /^(FA\d|MD\d|DT\d)/.test(t));
  expect(sets).toEqual(['FA00007074000;FA;', 'MD6;MD;', 'DT0;DT;', 'MD6;MD;']);
  await expect(band).toContainText('40m');
  await expect(band).toContainText('7.074');
  await band.click();
  await expect(page.getByTestId('radio-line')).toHaveText('The KX2 is on 7.074 MHz DATA A.');
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();

  // The operator turns the radio's dial into 15m: RR73 follows by polling within about 1 s.
  await page.evaluate(() => window.__kx2.turnDial(21_076_000));
  await expect(band).toContainText('15m', { timeout: 2000 });

  // The port allowed before opens again by itself when the app opens.
  await page.reload();
  await page.evaluate(() => (location.hash = '#/settings/rig'));
  await expect(page.getByTestId('rig-status')).toHaveText('Connected');
  await expect(page.getByRole('radio', { name: /Elecraft KX2/ })).toHaveAttribute('aria-checked', 'true');
  expect(await kx2Ptt(page)).toEqual([]);
});

test('a new baud rate opens the port again at that rate, with the lines lowered and no TX', async ({ page }) => {
  await installFakeKx2(page);
  await page.goto('./');
  await connectKx2(page);
  await page.getByRole('combobox', { name: 'Baud rate' }).selectOption('38400');
  await expect.poll(() => page.evaluate(() => window.__kx2.baud)).toBe(38400);
  await expect(page.getByTestId('rig-status')).toHaveText('Connected');
  expect(await page.evaluate(() => [window.__kx2.dtr, window.__kx2.rts])).toEqual([false, false]);
  expect(await kx2Ptt(page)).toEqual([]);
});

test('Test keying keys a KX2 with TX for 1 s and releases it with RX, with Key the radio with CAT off', async ({ page }) => {
  await installFakeKx2(page);
  await page.goto('./');
  await connectKx2(page);
  await expect(page.getByRole('switch', { name: /^Key the radio with CAT/ })).not.toBeChecked();
  await page.getByRole('button', { name: 'Test keying' }).click();
  await expect(page.getByTestId('rig-test')).toHaveText(/^Keyed and released at \d\d:\d\d:\d\d UTC\.$/, { timeout: 5000 });
  const p = await kx2Ptt(page);
  expect(p.map((w) => w.text)).toEqual(['TX;TQ;', 'RX;TQ;']);
  expect(p[1].at - p[0].at).toBeGreaterThanOrEqual(950);
  expect(p[1].at - p[0].at).toBeLessThan(1500);
  expect(await page.evaluate(() => window.__kx2.transmit)).toBe(false);
});

test('a KX2 that keeps transmitting after RX: Test keying says to unkey it, and the error clears once it receives', async ({ page }) => {
  await installFakeKx2(page);
  await page.goto('./');
  await connectKx2(page);
  await page.evaluate(() => (window.__kx2.ignoreRx = true));
  await page.getByRole('button', { name: 'Test keying' }).click();
  await expect(page.getByTestId('rig-test')).toHaveText('Keyed. PTT off was not confirmed.', { timeout: 5000 });
  await expect(page.getByTestId('rig-status')).toHaveText('PTT off not confirmed');
  await expect(page.getByTestId('rig-help')).toHaveText('The KX2 did not confirm PTT off. If it still transmits, unkey it at the radio or turn it off.');
  const rx = (await kx2Ptt(page)).filter((w) => w.text === 'RX;TQ;');
  expect(rx.length).toBeGreaterThanOrEqual(4);
  for (let i = 1; i < 4; i++) expect(rx[i].at - rx[i - 1].at).toBeGreaterThanOrEqual(95);
  await page.evaluate(() => (window.__kx2.ignoreRx = false));
  await expect(page.getByTestId('rig-status')).toHaveText('Connected', { timeout: 3000 });
  expect(await page.evaluate(() => window.__kx2.transmit)).toBe(false);
});
