// Settings › Radio and audio › Output in Chromium, whose fake devices list 3 outputs: the choice
// lists them, is saved, Tune, the start chime and capture's context play to it, capture keeps
// running when it changes, and a missing device shows as not connected (docs/design/cat.md, Audio).
// The Input choice is found again by its name, as the output is.
import { expect, test, type Page } from '@playwright/test';

// Fake devices for this file: the chromium project runs without them.
test.use({
  permissions: ['microphone'],
  launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
});

interface Recorded {
  contexts: AudioContext[];
  clipSinks: string[];
  gone: Set<string>;
  refused: Set<string>;
}

/**
 * Records every AudioContext and the output each media element plays to. setSinkId fails for
 * `gone` devices as if unplugged, and for `refused` ones as if the browser did not allow them.
 */
async function instrument(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __rec: Recorded };
    w.__rec = { contexts: [], clipSinks: [], gone: new Set(), refused: new Set() };
    const Base = window.AudioContext;
    window.AudioContext = class extends Base {
      constructor(o?: AudioContextOptions) {
        super(o);
        w.__rec.contexts.push(this);
      }
    };
    const proto = Base.prototype as unknown as { setSinkId(id: string): Promise<void> };
    const setSinkId = proto.setSinkId;
    proto.setSinkId = function (this: AudioContext, id: string) {
      if (w.__rec.gone.has(id)) return Promise.reject(new DOMException('Requested device not found', 'NotFoundError'));
      if (w.__rec.refused.has(id)) return Promise.reject(new DOMException('Not allowed', 'NotAllowedError'));
      return setSinkId.call(this, id);
    };
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      w.__rec.clipSinks.push(this.sinkId);
      return play.call(this);
    };
  });
}

const contextSink = (page: Page) =>
  page.evaluate(() => {
    const ctx = (window as unknown as { __rec: Recorded }).__rec.contexts[0];
    return ctx ? String((ctx as unknown as { sinkId: unknown }).sinkId) : null;
  });

const clipSinks = (page: Page) => page.evaluate(() => (window as unknown as { __rec: Recorded }).__rec.clipSinks);

/** The device ID of the output with this label, as this page sees it. */
const outputId = (page: Page, label: string) =>
  page.evaluate(async (l) => (await navigator.mediaDevices.enumerateDevices()).find((d) => d.kind === 'audiooutput' && d.label === l)?.deviceId ?? '', label);

const outputSelect = (page: Page) => page.getByRole('combobox', { name: /^Output/ });

test('lists the outputs, keeps the choice, and Tune plays to it', async ({ page }) => {
  await instrument(page);
  await page.goto('./#/settings/radio');
  const select = outputSelect(page);
  await expect(select).toBeVisible();
  await expect(select.locator('option')).toHaveText(['System default', 'Fake Audio Output 1', 'Fake Audio Output 2']);
  await expect(select).toHaveValue('');

  await select.selectOption({ label: 'Fake Audio Output 1' });
  const id1 = await outputId(page, 'Fake Audio Output 1');
  expect(id1).not.toBe('');
  await expect(select).toHaveValue(id1);

  await page.getByRole('button', { name: /^Tune for 10 s/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Tuning' });
  await expect(sheet).toBeVisible();
  await expect.poll(() => contextSink(page)).toBe(id1);
  await sheet.getByRole('button', { name: 'Halt' }).click();
  await expect(sheet).toBeHidden();

  // Playwright's Chromium gives devices new IDs on every page load, as a private window does: the
  // choice is found again by its name and saved under the new ID.
  await page.reload();
  const again = await outputId(page, 'Fake Audio Output 1');
  expect(again).not.toBe(id1);
  await expect(outputSelect(page)).toHaveValue(again);
  await expect(outputSelect(page).locator('option:checked')).toHaveText('Fake Audio Output 1');
  await expect(page.getByTestId('output-foot')).toHaveCount(0);
  await page.getByRole('button', { name: /^Tune for 10 s/ }).click();
  await expect.poll(() => contextSink(page)).toBe(again);
  await page.getByRole('dialog', { name: 'Tuning' }).getByRole('button', { name: 'Halt' }).click();
});

test('the start chime and capture play to the chosen output, and capture keeps running when it changes', async ({ page }) => {
  await instrument(page);
  await page.goto('./#/settings/radio');
  await outputSelect(page).selectOption({ label: 'Fake Audio Output 2' });
  const id1 = await outputId(page, 'Fake Audio Output 1');
  const id2 = await outputId(page, 'Fake Audio Output 2');

  await page.evaluate(() => (location.hash = '#/'));
  await page.getByRole('button', { name: 'Start audio' }).click();
  await expect(page.getByRole('timer', { name: /Receiving$/ })).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => clipSinks(page)).toEqual([id2]);
  await expect.poll(() => contextSink(page)).toBe(id2);

  await page.evaluate(() => (location.hash = '#/settings/radio'));
  await outputSelect(page).selectOption({ label: 'Fake Audio Output 1' });
  await expect.poll(() => contextSink(page)).toBe(id1);
  await page.evaluate(() => (location.hash = '#/'));
  // Chromium suspends the context for a moment during the switch; capture carries on.
  await page.waitForTimeout(2000);
  await expect(page.getByRole('timer', { name: /Receiving$/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Resume audio' })).toHaveCount(0);
  const meter = page.getByRole('meter', { name: 'Input level' });
  await expect(meter).toHaveAttribute('aria-valuetext', /^−\d+ dBFS$/);
});

test('an output the browser cannot find or refuses says so, and audio plays on', async ({ page }) => {
  await instrument(page);
  await page.goto('./#/settings/radio');
  await page.getByRole('button', { name: 'Start audio' }).click();
  await expect(page.getByRole('meter', { name: 'Input level' })).toHaveAttribute('aria-valuetext', /^−\d+ dBFS$/, { timeout: 15_000 });
  const id2 = await outputId(page, 'Fake Audio Output 2');
  await page.evaluate((id) => (window as unknown as { __rec: Recorded }).__rec.gone.add(id), id2);

  await outputSelect(page).selectOption({ label: 'Fake Audio Output 2' });
  await expect(page.getByTestId('output-foot')).toHaveText('The chosen output is not connected, so transmit audio plays through the system default.');
  expect(await contextSink(page)).toBe('');
  await expect(page.getByRole('button', { name: 'Start audio' })).toHaveCount(0);

  const id1 = await outputId(page, 'Fake Audio Output 1');
  await page.evaluate((id) => (window as unknown as { __rec: Recorded }).__rec.refused.add(id), id1);
  await outputSelect(page).selectOption({ label: 'Fake Audio Output 1' });
  await expect(page.getByTestId('output-foot')).toHaveText('The browser refused the chosen output, so transmit audio plays through the system default.');

  // Back to the system default: nothing to say.
  await outputSelect(page).selectOption({ label: 'System default' });
  await expect(page.getByTestId('output-foot')).toHaveCount(0);
  expect(await contextSink(page)).toBe('');
});

test('the chosen input is found again by its name when the browser gives it a new ID', async ({ page }) => {
  await page.goto('./#/settings/radio');
  const input = page.getByRole('combobox', { name: /^Input/ });
  await expect(input.locator('option')).toContainText(['Fake Audio Input 2']);
  await input.selectOption({ label: 'Fake Audio Input 2' });
  const inputId = (label: string) => page.evaluate(async (l) => (await navigator.mediaDevices.enumerateDevices()).find((d) => d.kind === 'audioinput' && d.label === l)?.deviceId ?? '', label);
  const id1 = await inputId('Fake Audio Input 2');
  await expect(input).toHaveValue(id1);

  // A new ID on the next load: the choice is found by its name, and audio starts on it.
  await page.reload();
  const again = await inputId('Fake Audio Input 2');
  expect(again).not.toBe(id1);
  await expect(input).toHaveValue(again);
  await expect(input.locator('option:checked')).toHaveText('Fake Audio Input 2');
  await page.getByRole('button', { name: 'Start audio' }).click();
  await expect(page.getByRole('meter', { name: 'Input level' })).toHaveAttribute('aria-valuetext', /^−\d+ dBFS$/, { timeout: 15_000 });
});
