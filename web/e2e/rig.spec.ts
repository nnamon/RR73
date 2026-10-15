// Rig control end to end in Chromium (docs/design/cat.md), with navigator.serial replaced by a fake
// IC-705 (fake-ic705.ts) and the app's output recorded in the page (tap.ts): connecting, the dial
// read from the radio, a band change setting the radio, Test keying, and PTT around a CQ with Key
// the radio with CAT off and on, Halt, and a lost port.
import { expect, test, type Page } from '@playwright/test';
import { installFakeIc705, rigFrames, type RigFrame } from './fake-ic705';
import { prepare, waitForTransmissions } from './txhelp';
import { SLOT_MS } from './tap';

// The transmissions wait for slots and time PTT against the audio clock, as the transmit projects'
// tests do, so they get the same 2 retries on a loaded machine.
test.describe.configure({ retries: 2 });

// A microphone for Start audio: the chromium project runs without one.
test.use({
  permissions: ['microphone'],
  launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
});

const rigLog = (page: Page) => page.evaluate(() => window.__rig.log) as Promise<RigFrame[]>;
const ptt = async (page: Page) => rigFrames(await rigLog(page)).filter((f) => f.body === '1C 00 01' || f.body === '1C 00 00');

async function connect(page: Page) {
  await page.evaluate(() => (location.hash = '#/settings/rig'));
  await page.getByRole('button', { name: 'Connect radio' }).click();
  await expect(page.getByTestId('rig-status')).toHaveText('Connected');
}

async function setKeying(page: Page, on: boolean) {
  await page.evaluate(() => (location.hash = '#/settings/rig'));
  const sw = page.getByRole('switch', { name: /Key the radio with CAT/ });
  if ((await sw.isChecked()) !== on) await sw.click();
  await expect(sw).toBeChecked({ checked: on });
}

/** Waits for an odd FT8 slot 3 to 12 s old: a CQ tapped then goes out at the next, even, slot on time. */
async function waitForOddSlot(page: Page) {
  for (;;) {
    const now = Date.now();
    const odd = Math.floor(now / SLOT_MS) % 2 === 1;
    const phase = now % SLOT_MS;
    if (odd && phase >= 3000 && phase <= 12_000) return;
    await page.waitForTimeout(odd && phase < 3000 ? 3000 - phase : 500);
  }
}

test('connects, shows the dial the radio reports, and a band change sets the radio', async ({ page }) => {
  await installFakeIc705(page, { hz: 14_076_000 });
  await page.goto('./#/settings');
  await page.getByRole('link', { name: /Rig control/ }).click();
  await expect(page.getByTestId('rig-status')).toHaveText('Off');
  await page.getByRole('button', { name: 'Connect radio' }).click();
  await expect(page.getByTestId('rig-status')).toHaveText('Connected');
  await expect(page.getByTestId('rig-dial')).toHaveText('14.076 MHz USB');
  // DTR and RTS low, and connecting sent no PTT.
  expect(await page.evaluate(() => [window.__rig.dtr, window.__rig.rts])).toEqual([false, false]);
  expect(await ptt(page)).toEqual([]);
  await expect(page.getByRole('listitem').filter({ hasText: 'USB SEND' })).toContainText('OFF');
  await expect(page.getByRole('listitem').filter({ hasText: 'DATA MOD' })).toContainText('USB');
  await expect(page.getByRole('listitem').filter({ hasText: 'Time-Out Timer' })).toContainText('5 min');

  await page.evaluate(() => (location.hash = '#/'));
  const band = page.getByRole('button', { name: /^Change band/ });
  await expect(band).toContainText('14.076');
  await band.click();
  await expect(page.getByTestId('radio-line')).toHaveText('The IC-705 is on 14.076 MHz USB.');
  const sheet = page.getByRole('dialog', { name: 'Change band' });
  await expect(sheet.getByText('The dial comes from the IC-705. Saved slots and QSOs record it.')).toBeVisible();
  const before = (await rigLog(page)).length;
  await sheet.getByText('40m', { exact: true }).click();
  await expect.poll(() => page.evaluate(() => [window.__rig.hz, window.__rig.mode, window.__rig.data])).toEqual([7_074_000, 1, 1]);
  const set = rigFrames(await rigLog(page), before).map((f) => f.body).filter((b) => !b.startsWith('03') && !b.startsWith('04') && b !== '1A 06' && b !== '1C 00');
  expect(set).toEqual(['05 00 40 07 07 00', '06 01 01', '1A 06 01 01']);
  await expect(band).toContainText('40m');
  await expect(band).toContainText('7.074');

  // The operator turns the radio's dial into 15m: RR73 follows within about 1 s.
  await page.evaluate(() => window.__rig.turnDial(21_076_000));
  await expect(band).toContainText('15m', { timeout: 1500 });
  await expect(band).toContainText('21.076');

  // The port allowed before opens again by itself when the app opens.
  await page.reload();
  await page.evaluate(() => (location.hash = '#/settings/rig'));
  await expect(page.getByTestId('rig-status')).toHaveText('Connected');
  expect(await ptt(page)).toEqual([]);
});

test('Test keying keys the radio for 1 s and releases it, with Key the radio with CAT off', async ({ page }) => {
  await installFakeIc705(page);
  await page.goto('./');
  await connect(page);
  await expect(page.getByRole('switch', { name: /Key the radio with CAT/ })).not.toBeChecked();
  await page.getByRole('button', { name: 'Test keying' }).click();
  await expect(page.getByTestId('rig-test')).toHaveText(/^Keyed for 1 s and released at \d\d:\d\d:\d\d UTC\.$/, { timeout: 5000 });
  const p = await ptt(page);
  expect(p.map((f) => f.body)).toEqual(['1C 00 01', '1C 00 00']);
  expect(p[1].at - p[0].at).toBeGreaterThanOrEqual(950);
  expect(p[1].at - p[0].at).toBeLessThan(1500);
  expect(await page.evaluate(() => window.__rig.transmit)).toBe(false);
});

test('a CQ keys no PTT with Key the radio with CAT off; on, PTT goes on before the audio and off after it, and Halt unkeys at once', async ({ page }) => {
  test.setTimeout(180_000);
  await installFakeIc705(page);
  const dock = await prepare(page);
  await connect(page);
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('link', { name: 'Operate' }).click();
  await page.getByRole('button', { name: 'Start audio' }).click();
  await expect(page.getByRole('timer', { name: /Receiving$/ })).toBeVisible({ timeout: 10_000 });

  // Off: the audio plays and no PTT goes to the radio.
  await waitForOddSlot(page);
  await dock.getByRole('button', { name: 'CQ', exact: true }).click();
  const [first] = await waitForTransmissions(page, 1, 30_000);
  expect(first.endUtc - first.startUtc).toBeGreaterThan(12_000);
  expect(await ptt(page)).toEqual([]);

  // On: the next CQ, 30 s later, keys the radio 0.5 s before its audio, which still starts at
  // slot + 0.5 s, and unkeys after it ends.
  await setKeying(page, true);
  await page.evaluate(() => (location.hash = '#/'));
  const [, second] = await waitForTransmissions(page, 2, 35_000);
  // tx-cq.spec holds the start to 50 ms in its own project; beside the rest of this project's
  // tests, the recorded start wanders further.
  const slot = Math.round((second.startUtc - 500) / SLOT_MS) * SLOT_MS;
  expect(Math.abs(second.startUtc - (slot + 500))).toBeLessThanOrEqual(150);
  await expect.poll(async () => (await ptt(page)).length, { timeout: 2000 }).toBe(2);
  const [on, off] = await ptt(page);
  test.info().annotations.push({ type: 'ptt', description: JSON.stringify({ onBeforeAudioMs: second.startUtc - on.at, offAfterAudioMs: off.at - second.endUtc }) });
  // Keyed at the pre-roll, 0.5 s ahead; the audio starts 0.1 s or more after the radio's OK, which
  // the fake radio sends 5 ms after PTT on.
  expect(on.body).toBe('1C 00 01');
  expect(second.startUtc - on.at).toBeGreaterThanOrEqual(100);
  expect(second.startUtc - on.at).toBeLessThanOrEqual(700);
  // PTT goes off the output latency and 0.1 s after the audio ends; the recorded end wanders by about
  // 0.1 s on a loaded machine.
  expect(off.body).toBe('1C 00 00');
  expect(off.at - second.endUtc).toBeGreaterThanOrEqual(-150);
  expect(off.at - second.endUtc).toBeLessThanOrEqual(500);

  // The next CQ: Halt 2 s into it sends PTT off at once.
  await expect(dock.getByText('On air')).toBeVisible({ timeout: 35_000 });
  await page.waitForTimeout(2000);
  const n = (await ptt(page)).length;
  await dock.getByRole('button', { name: 'Halt' }).click();
  await expect.poll(async () => (await ptt(page)).length).toBeGreaterThan(n);
  const haltAt = await page.evaluate(() => window.__haltAt);
  const after = (await ptt(page)).slice(n);
  expect(after[0].body).toBe('1C 00 00');
  expect(after[0].at - haltAt).toBeLessThan(50);
  await expect(dock.getByRole('button', { name: 'Tx off' })).toBeVisible();
  expect(await page.evaluate(() => window.__rig.transmit)).toBe(false);
});

test('a lost port during a transmission stops the audio and turns Tx off', async ({ page }) => {
  test.setTimeout(120_000);
  await installFakeIc705(page);
  const dock = await prepare(page);
  await connect(page);
  await setKeying(page, true);
  await page.evaluate(() => (location.hash = '#/'));
  await page.getByRole('button', { name: 'Start audio' }).click();
  await expect(page.getByRole('timer', { name: /Receiving$/ })).toBeVisible({ timeout: 10_000 });
  await waitForOddSlot(page);
  await dock.getByRole('button', { name: 'CQ', exact: true }).click();
  await expect(dock.getByText('On air')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(2000);
  const pulled = await page.evaluate(() => {
    window.__rig.unplug();
    return Date.now();
  });
  const [cut] = await waitForTransmissions(page, 1, 5000);
  // The audio stopped within one render quantum of the port going, plus the tap's timing.
  expect(cut.endUtc - pulled).toBeLessThan(150);
  expect(cut.endUtc - cut.startUtc).toBeLessThan(5000);
  await expect(dock.getByRole('button', { name: 'Tx off' })).toBeVisible();
  await expect(dock.getByText('Radio disconnected · Tx off')).toBeVisible();
  // Tx stays off while Key the radio with CAT waits for the radio: a CQ is refused.
  await dock.getByRole('button', { name: 'CQ', exact: true }).click();
  await expect(dock.getByText('Radio not connected')).toBeVisible({ timeout: 20_000 });
  await page.evaluate(() => (location.hash = '#/settings/rig'));
  await expect(page.getByTestId('rig-status')).toHaveText('Port closed');
  await expect(page.getByTestId('rig-help')).toContainText('Tx went off');
});

test('Tune keys the radio before the tone and releases it when the tone ends, and Halt releases it at once', async ({ page }) => {
  test.setTimeout(90_000);
  await installFakeIc705(page);
  // The page's own time of the tap on Halt.
  await page.addInitScript(() => {
    window.addEventListener('click', (e) => {
      if ((e.target as Element).closest('button')?.textContent?.trim() === 'Halt') window.__haltAt = Date.now();
    }, true);
  });
  await page.goto('./');
  await connect(page);
  await setKeying(page, true);
  await page.evaluate(() => (location.hash = '#/settings/radio'));
  await page.getByRole('button', { name: /^Tune for 10 s/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Tuning' });
  await expect(sheet).toBeVisible();
  await expect.poll(async () => (await ptt(page)).map((f) => f.body)).toEqual(['1C 00 01']);
  // The tone ends after 10 s: PTT off follows.
  await expect(sheet).toBeHidden({ timeout: 15_000 });
  await expect.poll(async () => (await ptt(page)).map((f) => f.body)).toEqual(['1C 00 01', '1C 00 00']);
  const [on, off] = await ptt(page);
  expect(off.at - on.at).toBeGreaterThan(10_000);
  expect(off.at - on.at).toBeLessThan(11_500);
  // Again, with Halt 1 s in.
  await page.getByRole('button', { name: /^Tune for 10 s/ }).click();
  await expect(sheet).toBeVisible();
  await page.waitForTimeout(1000);
  await sheet.getByRole('button', { name: 'Halt' }).click();
  await expect.poll(async () => (await ptt(page)).length).toBe(4);
  const halted = await page.evaluate(() => window.__haltAt);
  const last = (await ptt(page))[3];
  expect(last.body).toBe('1C 00 00');
  expect(last.at - halted).toBeLessThan(100);
  expect(await page.evaluate(() => window.__rig.transmit)).toBe(false);
});

test('an RTTY transmission keys the radio before the stream and releases it when the stream drains', async ({ page }) => {
  test.setTimeout(90_000);
  await installFakeIc705(page);
  await prepare(page);
  await connect(page);
  await setKeying(page, true);
  await page.evaluate(() => (location.hash = '#/'));
  await page.getByRole('button', { name: /^Change band/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Change band' });
  await sheet.getByText('RTTY', { exact: true }).click();
  // Choosing RTTY sets the radio to the band's RTTY dial in USB-D.
  await expect.poll(() => page.evaluate(() => [window.__rig.hz, window.__rig.data])).toEqual([14_083_000, 1]);
  // Esc closes the sheet, and as Halt it sends PTT off.
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await page.getByRole('button', { name: 'Start audio' }).click();
  await expect(page.getByRole('timer', { name: /Receiving$/ })).toBeVisible({ timeout: 10_000 });
  const n = (await ptt(page)).length;
  const bar = page.getByRole('region', { name: 'Transmit' });
  const field = page.getByTestId('send-field');
  await field.fill('CQ DE 9V1NE K');
  await field.press('Enter');
  await expect(bar.getByRole('button', { name: 'Tx off' })).toBeVisible({ timeout: 30_000 });
  const [t] = await waitForTransmissions(page, 1, 5000);
  await expect.poll(async () => (await ptt(page)).length).toBe(n + 2);
  const [on, off] = (await ptt(page)).slice(n);
  test.info().annotations.push({ type: 'rtty-ptt', description: JSON.stringify({ onBeforeAudioMs: t.startUtc - on.at, offAfterAudioMs: off.at - t.endUtc }) });
  expect(on.body).toBe('1C 00 01');
  expect(t.startUtc - on.at).toBeGreaterThanOrEqual(90);
  // PTT goes off the output latency and 0.1 s after the stream drains. The recorded end wanders by
  // about 0.1 s on a loaded machine.
  expect(off.body).toBe('1C 00 00');
  expect(off.at - t.endUtc).toBeGreaterThanOrEqual(-150);
  expect(off.at - t.endUtc).toBeLessThan(600);
});

test('audio stopping during a transmission sends PTT off at once and turns Tx off', async ({ page }) => {
  test.setTimeout(120_000);
  await installFakeIc705(page);
  const dock = await prepare(page);
  await connect(page);
  await setKeying(page, true);
  await page.evaluate(() => (location.hash = '#/'));
  await page.getByRole('button', { name: 'Start audio' }).click();
  await expect(page.getByRole('timer', { name: /Receiving$/ })).toBeVisible({ timeout: 10_000 });
  await waitForOddSlot(page);
  await dock.getByRole('button', { name: 'CQ', exact: true }).click();
  await expect(dock.getByText('On air')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  const n = (await ptt(page)).length;
  const stoppedAt = await page.evaluate(async () => {
    const at = Date.now();
    await window.__rr73!.suspendAudio();
    return at;
  });
  await expect.poll(async () => (await ptt(page)).length).toBeGreaterThan(n);
  const off = (await ptt(page))[n];
  expect(off.body).toBe('1C 00 00');
  expect(off.at - stoppedAt).toBeLessThan(150);
  await expect(dock.getByRole('button', { name: 'Tx off' })).toBeVisible();
  expect(await page.evaluate(() => window.__rig.transmit)).toBe(false);
});
