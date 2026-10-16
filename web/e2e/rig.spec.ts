// Rig control end to end in Chromium (docs/design/cat.md), with navigator.serial replaced by a fake
// IC-705 (fake-ic705.ts): connecting, the dial read from the radio, a band change setting the radio,
// the radio's dial followed, opening again after a reload, and Test keying with a radio that answers
// and one that keeps transmitting. The transmissions, timed against the audio, are in rig-tx.spec.ts.
import { expect, test, type Page } from '@playwright/test';
import { connect, installFakeIc705, ptt, rigFrames, rigLog, rigOn } from './fake-ic705';

test('connects, shows the dial the radio reports, and a band change sets the radio', async ({ page }) => {
  await installFakeIc705(page, { hz: 14_076_000 });
  await page.goto('./#/settings');
  await page.getByRole('link', { name: /Rig control/ }).click();
  await rigOn(page);
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
  // Connecting changed nothing on the radio: it is still in USB.
  await expect(page.getByTestId('radio-line')).toHaveText('The IC-705 is on 14.076 MHz USB. Choose the band to set USB-D.');
  const sheet = page.getByRole('dialog', { name: 'Change band' });
  await expect(sheet.getByText('The dial comes from the IC-705. Saved slots and QSOs record it.')).toBeVisible();
  const before = (await rigLog(page)).length;
  await sheet.getByText('40m', { exact: true }).click();
  await expect.poll(() => page.evaluate(() => [window.__rig.hz, window.__rig.mode, window.__rig.data])).toEqual([7_074_000, 1, 1]);
  // Reads aside (the dial, the mode, transmit, split, RIT and ΔTX), the sets in order.
  const reads = ['1A 06', '1C 00', '0F', '21 00', '21 01', '21 02'];
  const set = rigFrames(await rigLog(page), before).map((f) => f.body).filter((b) => !b.startsWith('03') && !b.startsWith('04') && !reads.includes(b));
  expect(set).toEqual(['05 00 40 07 07 00', '06 01 01', '1A 06 01 01']);
  await expect(band).toContainText('40m');
  await expect(band).toContainText('7.074');
  await band.click();
  await expect(page.getByTestId('radio-line')).toHaveText('The IC-705 is on 7.074 MHz USB-D.');
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();

  // The operator turns the radio's dial into 15m: RR73 follows within about 1 s.
  await page.evaluate(() => window.__rig.turnDial(21_076_000));
  await expect(band).toContainText('15m', { timeout: 1500 });
  await expect(band).toContainText('21.076');

  // The port allowed before opens again by itself when the app opens.
  await page.reload();
  await page.evaluate(() => (location.hash = '#/settings/rig'));
  await rigOn(page);
  await expect(page.getByTestId('rig-status')).toHaveText('Connected');
  expect(await ptt(page)).toEqual([]);
});

test('connects when the driver refuses to lower DTR and RTS and USB SEND reads OFF', async ({ page }) => {
  await installFakeIc705(page);
  await page.goto('./#/settings/rig');
  await rigOn(page);
  await page.evaluate(() => (window.__rig.refuseSignals = true));
  await page.getByRole('button', { name: 'Connect radio' }).click();
  await expect(page.getByTestId('rig-status')).toHaveText('Connected');
  await expect(page.getByTestId('rig-lines')).toHaveText('DTR and RTS could not be lowered. With USB SEND OFF, the radio ignores them.');
  expect(await page.evaluate(() => [window.__rig.opened, window.__rig.dtr, window.__rig.rts])).toEqual([true, true, true]);
  // USB SEND read first, before anything else went out; no PTT.
  expect(rigFrames(await rigLog(page))[0].body).toBe('1A 05 01 25');
  expect(await ptt(page)).toEqual([]);
  await expect(page.getByRole('listitem').filter({ hasText: 'USB SEND' })).toContainText('OFF');
});

test('reads split, duplex, RIT and ΔTX, and says what to change', async ({ page }) => {
  await installFakeIc705(page);
  await page.goto('./');
  await connect(page);
  const row = (title: string) => page.getByRole('listitem').filter({ has: page.locator('.row-title', { hasText: new RegExp(`^${title}$`) }) });
  await expect(row('Split')).toContainText('Off');
  await expect(row('RIT')).toContainText('Off');
  await expect(row('ΔTX')).toContainText('Off');
  await expect(page.getByTestId('rig-advice')).toHaveCount(0);
  // The operator turns split and ΔTX on at the radio, with the offset at +120 Hz: read within 5 s.
  await page.evaluate(() => {
    window.__rig.split = 0x01;
    window.__rig.xit = true;
    window.__rig.ritHz = 120;
  });
  await expect(row('Split')).toContainText('On', { timeout: 7000 });
  await expect(row('ΔTX')).toContainText('On, +120 Hz');
  await expect(page.getByTestId('rig-advice')).toHaveText([
    'Split is on: the IC-705 transmits on the other VFO, away from the frequency RR73 logs. Touch SPLIT on the FUNCTION screen to turn it off.',
    'ΔTX (XIT) is on: the IC-705 transmits 120 Hz above the dial, away from the frequency RR73 logs. Push the RIT/ΔTX key to turn it off.',
  ]);
  // Duplex, and RIT in place of ΔTX at −50 Hz.
  await page.evaluate(() => {
    window.__rig.split = 0x11;
    window.__rig.xit = false;
    window.__rig.rit = true;
    window.__rig.ritHz = -50;
  });
  await expect(row('Split')).toContainText('DUP−', { timeout: 7000 });
  await expect(row('RIT')).toContainText('On, −50 Hz');
  await expect(page.getByTestId('rig-advice')).toHaveText([
    'Duplex is on: the IC-705 transmits at its duplex offset from the dial, away from the frequency RR73 logs. On FUNCTION screen 2, touch DUP until it shows OFF.',
    'RIT is on: the IC-705 receives 50 Hz below the dial it transmits on, so replies land 50 Hz from the station they answer. Push the RIT/ΔTX key to turn it off.',
  ]);
  // Only reads went out: no split, RIT or ΔTX set, and no PTT.
  const frames = rigFrames(await rigLog(page)).map((f) => f.body);
  expect(frames.filter((b) => (b.startsWith('0F') && b !== '0F') || (b.startsWith('21 ') && b.length > 5))).toEqual([]);
  expect(await ptt(page)).toEqual([]);
});

test('Test keying keys the radio for 1 s and releases it, with Key the radio with CAT off', async ({ page }) => {
  await installFakeIc705(page);
  await page.goto('./');
  await connect(page);
  await expect(page.getByRole('switch', { name: /^Key the radio with CAT/ })).not.toBeChecked();
  await page.getByRole('button', { name: 'Test keying' }).click();
  await expect(page.getByTestId('rig-test')).toHaveText(/^Keyed and released at \d\d:\d\d:\d\d UTC\.$/, { timeout: 5000 });
  const p = await ptt(page);
  expect(p.map((f) => f.body)).toEqual(['1C 00 01', '1C 00 00']);
  expect(p[1].at - p[0].at).toBeGreaterThanOrEqual(950);
  expect(p[1].at - p[0].at).toBeLessThan(1500);
  expect(await page.evaluate(() => window.__rig.transmit)).toBe(false);
});

test('a radio that keeps transmitting after PTT off: Test keying says to unkey it, and Rig control and Settings show it', async ({ page }) => {
  await installFakeIc705(page);
  await page.goto('./');
  await connect(page);
  await page.evaluate(() => (window.__rig.ignorePttOff = true));
  await page.getByRole('button', { name: 'Test keying' }).click();
  await expect(page.getByTestId('rig-test')).toHaveText('Keyed. PTT off was not confirmed.', { timeout: 5000 });
  await expect(page.getByTestId('rig-status')).toHaveText('PTT off not confirmed');
  await expect(page.getByTestId('rig-help')).toHaveText('The IC-705 did not confirm PTT off. If it still transmits, unkey it at the radio or turn it off.');
  // PTT off: once, then 3 more 100 ms apart, then read every second while the radio transmits.
  const offs = (await ptt(page)).filter((f) => f.body === '1C 00 00');
  expect(offs.length).toBeGreaterThanOrEqual(4);
  await page.evaluate(() => (location.hash = '#/settings'));
  await expect(page.getByRole('link', { name: /Rig control/ })).toContainText('PTT off not confirmed');
  // The radio takes PTT off again: the next read clears the error.
  await page.evaluate(() => (window.__rig.ignorePttOff = false));
  await expect(page.getByRole('link', { name: /Rig control/ })).toContainText('Connected', { timeout: 3000 });
  expect(await page.evaluate(() => window.__rig.transmit)).toBe(false);
});

test('Radio and audio says that Key the radio with CAT needs the radio’s audio as the output, while it is on and the output is System default', async ({ page }) => {
  await installFakeIc705(page);
  await page.goto('./');
  const foot = page.getByTestId('output-foot');
  await page.evaluate(() => (location.hash = '#/settings/radio'));
  await expect(page.getByRole('combobox', { name: /^Output/ })).toHaveValue('');
  await expect(foot).toHaveCount(0);
  await page.evaluate(() => (location.hash = '#/settings/rig'));
  await rigOn(page);
  await page.getByRole('switch', { name: /^Key the radio with CAT/ }).click();
  await page.evaluate(() => (location.hash = '#/settings/radio'));
  await expect(foot).toHaveText('Key the radio with CAT needs the IC-705’s USB audio here.');
  // The KX2 names the Digirig's sound card.
  await page.evaluate(() => (location.hash = '#/settings/rig'));
  await rigOn(page);
  await page.getByRole('radio', { name: /^Elecraft KX2/ }).click();
  await page.evaluate(() => (location.hash = '#/settings/radio'));
  await expect(foot).toHaveText('Key the radio with CAT needs the Digirig’s sound card here.');
  await page.evaluate(() => (location.hash = '#/settings/rig'));
  await rigOn(page);
  await page.getByRole('switch', { name: /^Key the radio with CAT/ }).click();
  await page.evaluate(() => (location.hash = '#/settings/radio'));
  await expect(foot).toHaveCount(0);
});

test('Keep Tx audio centred is off by default and works only with Key the radio with CAT on', async ({ page }) => {
  await installFakeIc705(page);
  await page.goto('./');
  await connect(page);
  const keying = page.getByRole('switch', { name: /^Key the radio with CAT/ });
  const shift = page.getByRole('switch', { name: /^Keep Tx audio centred/ });
  await expect(shift).not.toBeChecked();
  await expect(shift).toBeDisabled();
  await expect(page.getByTestId('rig-shift')).toHaveText('Needs Key the radio with CAT');
  await keying.click();
  await expect(shift).toBeEnabled();
  await expect(page.getByTestId('rig-shift')).toHaveText('Off: the dial stays put');
  await shift.click();
  await expect(shift).toBeChecked();
  await expect(page.getByTestId('rig-shift')).toHaveText('Signal stays on your Tx frequency');
  // Kept across a reload; with keying off it stays on and does nothing.
  await page.waitForTimeout(500);
  await page.reload();
  await page.evaluate(() => (location.hash = '#/settings/rig'));
  await rigOn(page);
  await expect(shift).toBeChecked();
  await keying.click();
  await expect(shift).toBeDisabled();
  await expect(page.getByTestId('rig-shift')).toHaveText('Needs Key the radio with CAT');
  // Turning it on sends nothing to the radio.
  expect(rigFrames(await rigLog(page)).filter((f) => f.body.startsWith('05 '))).toEqual([]);
});

/**
 * Operate's top bar at `vw` x `vh`: everything in it left to right with no overlaps and inside the
 * screen, the band button and the radio badge 44 pt targets or more, the badge's capsule 21 pt,
 * the bar's buttons 44 pt, and no sideways scroll.
 */
async function checkTopBar(page: Page, vw: number, vh: number) {
  await resize(page, vw, vh);
  const at = `at ${vw} x ${vh}`;
  const parts = await page.evaluate(() => {
    const top = document.querySelector('header.top')!;
    const items = [...top.children].flatMap((el) => (el.classList.contains('side') ? [...el.children] : [el]));
    return items
      .filter((el) => !el.classList.contains('grow') && !el.classList.contains('meter') && el.getBoundingClientRect().width > 0 && getComputedStyle(el).position !== 'absolute')
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { name: `${el.tagName.toLowerCase()}.${[...el.classList].filter((c) => !c.startsWith('svelte-')).join('.')}`, x: r.x, w: r.width, h: r.height };
      });
  });
  const names = parts.map((p) => `${p.name} ${Math.round(p.w)}`).join(', ');
  expect(parts[0].x, `${at}: ${names}`).toBeGreaterThanOrEqual(-0.5);
  for (let i = 1; i < parts.length; i++) expect(parts[i - 1].x + parts[i - 1].w, `${at}: ${parts[i - 1].name} then ${parts[i].name}`).toBeLessThanOrEqual(parts[i].x + 0.5);
  const last = parts[parts.length - 1];
  expect(last.x + last.w, `${at}: ${names}`).toBeLessThanOrEqual(vw + 0.5);
  // Short of room the badge shows its glyph alone, or none of it, and the band button keeps a 44 pt
  // target beside it.
  const band = parts.find((p) => p.name.startsWith('button.band'))!;
  const link = parts.find((p) => p.name.includes('radio'));
  if (link) {
    expect(band.w, `${at}: ${names}`).toBeGreaterThanOrEqual(43.5);
    expect(band.h, at).toBeGreaterThanOrEqual(43.5);
    expect(link.w, at).toBeGreaterThanOrEqual(43.5);
    expect(link.h, at).toBeGreaterThanOrEqual(43.5);
    expect(Math.round((await page.getByTestId('radio-badge').locator('.badge').boundingBox())!.height), at).toBe(21);
  }
  const screens = page.locator('header.top').getByRole('navigation', { name: 'Screens' }).getByRole('link');
  for (let i = 0; i < (await screens.count()); i++) expect((await screens.nth(i).boundingBox())!.height, `${at} screen ${i}`).toBeGreaterThanOrEqual(43.5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), at).toBe(true);
  test.info().annotations.push({ type: 'top-bar', description: `${at}: ${names}` });
  return parts;
}

/** Resizes the window and waits for its size class (lib/app/layout.svelte.ts) to follow. */
async function resize(page: Page, vw: number, vh: number) {
  await page.setViewportSize({ width: vw, height: vh });
  const size = vw < 700 ? 'compact' : vh < 500 ? 'compact-height' : 'regular';
  await page.waitForFunction((s) => document.documentElement.dataset.size === s, size);
  await expect(page.locator('header.top')).toBeVisible();
  // The badge fits itself after the resize is laid out: two frames.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

/**
 * The gap from the last glyph's ink to the screen's edge, pt: the Settings icon's drawn shapes in
 * the compact bar, the clock's text in the regular one.
 */
function edgeGap(page: Page): Promise<number> {
  return page.evaluate(() => {
    const top = document.querySelector('header.top')!;
    const vw = document.documentElement.clientWidth;
    if (top.classList.contains('regular')) return vw - top.querySelector('.utc')!.getBoundingClientRect().right;
    const svg = top.querySelector<SVGSVGElement>('a[aria-label="Settings"] svg')!;
    const box = svg.getBoundingClientRect();
    const scale = box.width / 24;
    let r = -Infinity;
    for (const el of svg.querySelectorAll<SVGGraphicsElement>('path, circle, ellipse, rect, line')) {
      const bb = el.getBBox();
      const cs = getComputedStyle(el);
      r = Math.max(r, bb.x + bb.width + (cs.stroke && cs.stroke !== 'none' ? parseFloat(cs.strokeWidth) / 2 : 0));
    }
    return vw - (box.left + r * scale);
  });
}

const SIZES = [
  [350, 667],
  [375, 667],
  [393, 852],
  [852, 393],
  [1024, 768],
  [1440, 900],
] as const;

test('Operate’s radio badge shows the connection, turns amber and red, opens Rig control, and fits the top bar', async ({ page }) => {
  await installFakeIc705(page);
  await page.goto('./');
  // Rig control off: no badge. The last glyph's gap to the edge at each size, to keep.
  await expect(page.locator('header.top')).toBeVisible();
  await expect(page.getByTestId('radio-badge')).toHaveCount(0);
  const gaps: number[] = [];
  for (const [vw, vh] of SIZES) {
    await resize(page, vw, vh);
    gaps.push(await edgeGap(page));
  }
  test.info().annotations.push({ type: 'edge-gaps', description: JSON.stringify(SIZES.map(([vw, vh], i) => `${vw}x${vh}: ${gaps[i].toFixed(1)}`)) });
  await page.setViewportSize({ width: 393, height: 852 });
  await connect(page);
  await page.evaluate(() => (location.hash = '#/'));
  const badge = page.getByTestId('radio-badge');
  const capsule = badge.locator('.badge');
  // Connected in USB: amber, naming the mode, until the band sheet sets USB-D.
  await expect(badge).toHaveText('USB');
  await expect(capsule).toHaveClass(/\bwarn\b/);
  await expect(badge).toHaveAttribute('aria-label', 'IC-705 connected, in USB. Open Rig control');
  await page.getByRole('button', { name: /^Change band/ }).click();
  await page.getByRole('dialog', { name: 'Change band' }).getByText('20m', { exact: true }).click();
  await expect(capsule).toHaveClass(/\bok\b/, { timeout: 7000 });
  await expect(badge).toHaveText('Connected');
  await expect(badge).toHaveAttribute('aria-label', 'IC-705 connected. Open Rig control');
  await expect(page.getByTestId('top-dial')).not.toHaveClass(/fallback/);
  for (const [i, [vw, vh]] of SIZES.entries()) {
    await checkTopBar(page, vw, vh);
    // The badge takes its room from the band button: the right edge stays where it was.
    expect(await edgeGap(page), `at ${vw} x ${vh}`).toBeCloseTo(gaps[i], 1);
  }
  // Short of room, with Spots shown and the practice band on: the band button and the badge give
  // way down to 44 pt targets, and nothing overlaps.
  await resize(page, 393, 852);
  await page.evaluate(() => (location.hash = '#/settings'));
  await page.getByRole('switch', { name: /^Activations/ }).check();
  await page.evaluate(() => (location.hash = '#/settings/practice'));
  await page.getByRole('switch', { name: /^Practice band/ }).check();
  await page.evaluate(() => (location.hash = '#/'));
  await expect(page.locator('header.top .practice')).toHaveText('Practice');
  await expect(page.locator('header.top').getByRole('link', { name: 'Spots' })).toBeVisible();
  for (const [vw, vh] of SIZES) await checkTopBar(page, vw, vh);
  await resize(page, 393, 852);
  await page.evaluate(() => (location.hash = '#/settings/practice'));
  await page.getByRole('switch', { name: /^Practice band/ }).uncheck();
  await page.evaluate(() => (location.hash = '#/settings'));
  await page.getByRole('switch', { name: /^Activations/ }).uncheck();
  await page.evaluate(() => (location.hash = '#/'));
  await expect(page.locator('header.top .practice')).toHaveCount(0);

  // The radio transmits with no PTT from RR73 (VOX, its own PTT): amber, read within 5 s.
  await page.evaluate(() => (window.__rig.transmit = true));
  await expect(capsule).toHaveClass(/\bwarn\b/, { timeout: 7000 });
  await expect(badge).toHaveText('Transmitting');
  await expect(badge).toHaveAttribute('aria-label', 'IC-705 connected, transmitting with no PTT from RR73. Open Rig control');
  await page.evaluate(() => (window.__rig.transmit = false));
  await expect(capsule).toHaveClass(/\bok\b/, { timeout: 7000 });

  // The radio stops answering: red, with the last dial it read.
  await page.evaluate(() => (window.__rig.silent = true));
  await expect(badge).toHaveText('No reply', { timeout: 7000 });
  await expect(capsule).toHaveClass(/\bbad\b/);
  await expect(page.getByTestId('top-dial')).not.toHaveClass(/fallback/);
  await page.evaluate(() => (window.__rig.silent = false));
  await expect(badge).toHaveText('Connected', { timeout: 3000 });

  // The port closes: red, and the dial shown is the band's own, in the warning tint.
  await page.evaluate(() => window.__rig.unplug());
  await expect(badge).toHaveText('Port closed');
  await expect(capsule).toHaveClass(/\bbad\b/);
  await expect(page.getByTestId('top-dial')).toHaveClass(/fallback/);
  await expect(page.getByRole('button', { name: /^Change band/ })).toHaveAttribute('aria-label', /the band’s own dial: the radio’s is not in use\.$/);
  for (const [vw, vh] of [
    [375, 667],
    [1440, 900],
  ])
    await checkTopBar(page, vw, vh);
  await resize(page, 393, 852);

  // A tap opens Rig control.
  await badge.click();
  await expect(page.getByTestId('rig-status')).toHaveText('Port closed');
  expect(await page.evaluate(() => location.hash)).toBe('#/settings/rig');
  await expect(page.getByTestId('rig-help')).toHaveText('The IC-705’s port closed, and Tx went off. Check the cable and the radio, then tap Reconnect radio.');

  // No connect event comes with the cable still in: Reconnect radio opens the allowed port without
  // the chooser. Connect radio stays, to choose another port.
  const chooser = await page.evaluate(() => window.__rig.chooser);
  await expect(page.getByRole('button', { name: /^Connect radio/ })).toContainText('Choose another port');
  await page.getByRole('button', { name: 'Reconnect radio' }).click();
  await expect(page.getByTestId('rig-status')).toHaveText('Connected');
  expect(await page.evaluate(() => window.__rig.chooser)).toBe(chooser);
  expect(await page.evaluate(() => [window.__rig.dtr, window.__rig.rts])).toEqual([false, false]);
  await expect(page.getByRole('button', { name: 'Reconnect radio' })).toHaveCount(0);
  await page.evaluate(() => (location.hash = '#/'));
  await expect(badge).toHaveText('Connected');
  await expect(page.getByTestId('top-dial')).not.toHaveClass(/fallback/);
  expect(await ptt(page)).toEqual([]);
});

test('plugging the radio in reconnects it until Disconnect radio, which shows while the port is closed', async ({ page }) => {
  await installFakeIc705(page);
  await page.goto('./#/settings');
  await page.getByRole('link', { name: /Rig control/ }).click();
  await rigOn(page);
  await page.getByRole('button', { name: 'Connect radio' }).click();
  await expect(page.getByTestId('rig-status')).toHaveText('Connected');

  // The cable out and in: RR73 opens the port again by itself.
  await page.evaluate(() => window.__rig.unplug());
  await expect(page.getByTestId('rig-status')).toHaveText('Port closed');
  await page.evaluate(() => window.__rig.plug());
  await expect(page.getByTestId('rig-status')).toHaveText('Connected');

  // Out again: Disconnect radio is there with the port closed, and after it plugging in opens nothing.
  await page.evaluate(() => window.__rig.unplug());
  await expect(page.getByTestId('rig-status')).toHaveText('Port closed');
  await page.getByRole('button', { name: /^Disconnect radio/ }).click();
  await expect(page.getByTestId('rig-status')).toHaveText('Off');
  await expect(page.getByRole('button', { name: /^Disconnect radio/ })).toHaveCount(0);
  await page.evaluate(() => window.__rig.plug());
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => window.__rig.opened)).toBe(false);
  await expect(page.getByTestId('rig-status')).toHaveText('Off');
  expect(await ptt(page)).toEqual([]);
});

test('Rig control’s switch off closes the port, opens nothing by itself and hides the badge; on opens the port again', async ({ page }) => {
  await installFakeIc705(page);
  await page.goto('./#/settings');
  await page.getByRole('link', { name: /Rig control/ }).click();
  const on = page.getByRole('switch', { name: 'Rig control' });
  await expect(on).not.toBeChecked();
  await on.check();
  await page.getByRole('button', { name: 'Connect radio' }).click();
  await expect(page.getByTestId('rig-status')).toHaveText('Connected');

  await on.uncheck();
  await expect.poll(() => page.evaluate(() => window.__rig.opened)).toBe(false);
  await expect(page.getByTestId('rig-status')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Connect radio/ })).toHaveCount(0);

  // Plugging in, and opening the app again, open nothing while it is off.
  await page.evaluate(() => window.__rig.plug());
  await page.reload();
  await expect(page.getByRole('switch', { name: 'Rig control' })).not.toBeChecked();
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => window.__rig.opened)).toBe(false);
  await page.evaluate(() => (location.hash = '#/settings'));
  await expect(page.getByRole('link', { name: /Rig control/ })).toContainText('Off');
  await page.evaluate(() => (location.hash = '#/'));
  await expect(page.locator('header.top')).toBeVisible();
  await expect(page.getByTestId('radio-badge')).toHaveCount(0);

  // On again: the port opens by itself, as the operator connected it before.
  await page.evaluate(() => (location.hash = '#/settings/rig'));
  await page.getByRole('switch', { name: 'Rig control' }).check();
  await expect(page.getByTestId('rig-status')).toHaveText('Connected');
  expect(await ptt(page)).toEqual([]);
});
