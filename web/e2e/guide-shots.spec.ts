// The guide's annotated screenshots (docs/guide/img/*.webp), in the guide-shots project only
// (RR73_GUIDE_SHOTS=1; docs/testing.md). The app runs as on an iPhone at 393 x 852 in WebKit, light
// theme, with the guide's example stations only: 9V1NE operating, AB4SS, 9V1DE and OE3OGC on the
// band. WebKit's mock microphone runs the audio and the e2e hooks supply decodes, spots and RTTY
// text, so each screen is the app's own. Numbered circles go on top of the page before the
// capture, matching the numbered legend under each image in the page's Markdown. Chromium encodes
// the WebP, which WebKit cannot, and shows Rig control, which needs Web Serial.
import { chromium, expect, test, type Locator, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { INSETS, SLOT, d, inject, phase, rowOf } from './operate-checks';
import { emptySeed, guideLog, seed, type Seed } from './log-data';
import { RELAY_SET_UP, routeRelay } from './relay-stand-in';
import { FIXED_TIME } from './time';
import { useTheme } from './theme';

const IMG = fileURLToPath(new URL('../../docs/guide/img/', import.meta.url));
/** The same captures as PNG, without circles, for choosing where they go. */
const RAW = fileURLToPath(new URL('../test-results/screens/guide-raw/', import.meta.url));
/** The largest file the guide takes, bytes (guide.test.ts). */
const MAX_BYTES = 40_000;

const STATION = { callsign: '9V1NE', grid: 'OJ11', freqPicked: true };

interface Callout {
  target: Locator;
  /** The circle's centre as a fraction of the target's box, 0 to 1 from its left and top edges, plus px offsets. */
  fx?: number;
  fy?: number;
  dx?: number;
  dy?: number;
  /** Measure the target's text, not its box: a label's box can run the width of its row. */
  text?: boolean;
}

/** Above the start of a line of text. */
const above = (target: Locator): Callout => ({ target, fx: 0, fy: 0, dx: 24, dy: -14 });
/** Centred on a control's bottom edge. */
const below = (target: Locator): Callout => ({ target, fy: 1, dy: 4 });
/** In the middle of the target. */
const mid = (target: Locator, fx = 0.5): Callout => ({ target, fx });
/** Just after a label's text. */
const after = (target: Locator): Callout => ({ target, fx: 1, dx: 18, text: true });
/** Near the right end of a row. */
const end = (target: Locator): Callout => ({ target, fx: 1, dx: -30 });

/** Puts numbered circles on the page, 1 first, styled as GuidePage's legend. */
async function addCallouts(page: Page, callouts: Callout[]) {
  const spots: { x: number; y: number }[] = [];
  for (const c of callouts) {
    const box = c.text
      ? await c.target.first().evaluate((el) => {
          const r = document.createRange();
          r.selectNodeContents(el);
          const b = r.getBoundingClientRect();
          return { x: b.x, y: b.y, width: b.width, height: b.height };
        })
      : (await c.target.first().boundingBox({ timeout: 5000 }))!;
    spots.push({ x: box.x + box.width * (c.fx ?? 0.5) + (c.dx ?? 0), y: box.y + box.height * (c.fy ?? 0.5) + (c.dy ?? 0) });
  }
  await page.evaluate((list) => {
    // A popover in the top layer, so the circles sit over open sheets too.
    const layer = document.createElement('div');
    layer.className = 'guide-callout';
    layer.setAttribute('popover', 'manual');
    Object.assign(layer.style, { position: 'fixed', inset: '0', width: '100vw', height: '100vh', margin: '0', padding: '0', border: '0', background: 'transparent', overflow: 'visible', pointerEvents: 'none' });
    document.body.append(layer);
    layer.showPopover();
    for (const [i, s] of list.entries()) {
      const el = document.createElement('span');
      el.textContent = String(i + 1);
      Object.assign(el.style, {
        position: 'fixed',
        left: `${s.x - 12}px`,
        top: `${s.y - 12}px`,
        width: '24px',
        height: '24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: '999px',
        background: getComputedStyle(document.documentElement).getPropertyValue('--rr-accent-fill'),
        color: '#fff',
        font: '700 13px/1 -apple-system, system-ui, sans-serif',
        boxShadow: '0 0 0 2px #fff, 0 1px 4px rgb(0 0 0 / 0.35)',
      });
      layer.append(el);
    }
  }, spots);
}

/** The PNG as WebP, scaled by `scale`, at the highest quality that stays under MAX_BYTES. */
async function toWebp(png: Buffer, scale = 1): Promise<Buffer> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    for (const q of [0.85, 0.8, 0.75, 0.7, 0.65, 0.6, 0.5, 0.4]) {
      const b64 = await page.evaluate(
        async ([src, quality, k]) => {
          const img = new Image();
          img.src = src as string;
          await img.decode();
          const c = document.createElement('canvas');
          c.width = Math.round(img.naturalWidth * (k as number));
          c.height = Math.round(img.naturalHeight * (k as number));
          const g = c.getContext('2d')!;
          g.imageSmoothingQuality = 'high';
          g.drawImage(img, 0, 0, c.width, c.height);
          const url = c.toDataURL('image/webp', quality as number);
          if (!url.startsWith('data:image/webp')) throw new Error('No WebP encoder');
          return url.slice(url.indexOf(',') + 1);
        },
        [`data:image/png;base64,${png.toString('base64')}`, q, scale] as const,
      );
      const out = Buffer.from(b64, 'base64');
      if (out.length < MAX_BYTES) return out;
    }
    throw new Error('Image stays over the size limit: crop it smaller');
  } finally {
    await browser.close();
  }
}

type Clip = { x: number; y: number; width: number; height: number };

/** The screen from `top` to `bottom` (CSS px), full width. */
const band = (page: Page, top: number, bottom: number): Clip => ({ x: 0, y: Math.max(0, top), width: page.viewportSize()!.width, height: Math.min(page.viewportSize()!.height, bottom) - Math.max(0, top) });

/** Adds the callouts and captures `clip` as docs/guide/img/<name>.webp, scaled by `scale` for a tall screen. */
async function save(page: Page, name: string, clip: Clip, callouts: Callout[], scale = 1) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  mkdirSync(RAW, { recursive: true });
  await page.screenshot({ path: `${RAW}${name}.png` });
  await addCallouts(page, callouts);
  const png = await page.screenshot({ clip });
  const webp = await toWebp(png, scale);
  mkdirSync(IMG, { recursive: true });
  writeFileSync(`${IMG}${name}.webp`, webp);
  console.log(`${name}.webp ${webp.length} bytes`);
}

async function insets(page: Page) {
  await page.addInitScript((i) => {
    document.addEventListener('DOMContentLoaded', () => {
      const s = document.createElement('style');
      s.textContent = `:root { --rr-safe-top: ${i.top}px; --rr-safe-bottom: ${i.bottom}px; }`;
      document.head.append(s);
    });
  }, INSETS[393]);
  await useTheme(page, 'light');
}

/** The app with the station set, the seed stored and `settings` applied, at `path`. */
async function openApp(page: Page, path: string, settings: Record<string, unknown> = {}, data: Seed = emptySeed()) {
  await insets(page);
  await page.goto('./');
  await seed(page, data);
  await page.waitForFunction(() => !!window.__rr73);
  await page.evaluate((s) => window.__rr73!.settings(s as never), { ...STATION, ...settings });
  await page.goto(`./${path}`);
  await page.locator('main h1:visible').first().waitFor();
  await page.waitForTimeout(400);
}

async function startAudio(page: Page) {
  await page.getByRole('button', { name: 'Start audio' }).click();
  await expect(page.getByRole('button', { name: 'Start audio' })).toBeHidden({ timeout: 20_000 });
}

const txBar = (page: Page) => page.getByRole('region', { name: 'Transmit' });
const bottomOf = async (l: Locator) => {
  const b = (await l.first().boundingBox())!;
  return b.y + b.height;
};
const topOf = async (l: Locator) => (await l.first().boundingBox())!.y;

/** Two slots on 20m with the guide's stations. */
const SLOT_EVEN = [d('CQ AB4SS EM73', -12, 1210, 0.2), d('CQ OE3OGC JN88', -6, 1840, 0.1), d('OE3OGC 9V1DE OJ11', 4, 640, 0.1)];
const SLOT_ODD = [d('9V1NE OE3OGC JN88', -9, 1510, 0.2), d('9V1DE OE3OGC -07', -5, 1845, 0.1), d('CQ AB4SS EM73', -11, 1210, 0.2), d('AB4SS 9V1DE R+02', 2, 2240, 0.1)];

test('Making QSOs: the transmit controls and status line in a QSO under way', async ({ page }) => {
  test.setTimeout(180_000);
  await openApp(page, '#/operate');
  await startAudio(page);
  const bar = txBar(page);

  // AB4SS calls CQ; a double-tap answers it in the next slot of the other parity.
  const heard = await phase(page, 2, 5);
  await inject(page, heard - SLOT, SLOT_EVEN);
  await rowOf(page, 'CQ AB4SS EM73').evaluate((el: HTMLElement) => {
    el.click();
    el.click();
  });
  await expect(bar.getByRole('button', { name: 'On air' })).toBeVisible({ timeout: 40_000 });
  const ours = await page.evaluate(() => Date.now() - (Date.now() % 15_000));

  // AB4SS's report in the slot after ours: Tx3 with the R-report goes next.
  await page.waitForTimeout(Math.max(0, ours + SLOT + 500 - Date.now()));
  await inject(page, ours + SLOT, [d('9V1NE AB4SS -12', -10, 1215, 0.2), d('CQ OE3OGC JN88', -7, 1840, 0.1)]);
  await expect(bar.getByText(/^Tx3 · AB4SS 9V1NE R-10/)).toBeVisible();
  await page.waitForTimeout(400);

  const button = (id: string) => bar.locator(`[data-id=${id}]`);
  await save(page, 'operate-tx', band(page, (await topOf(bar)) - 32, 852), [
    above(bar.locator('.status .msg')),
    above(bar.locator('.status .aside')),
    below(button('tx')),
    below(button('cq')),
    below(button('hunt')),
    below(button('more')),
    below(button('halt')),
  ]);
});

test('Operate: the waterfall and the decode list', async ({ page }) => {
  test.setTimeout(120_000);
  await openApp(page, '#/operate', { txHz: 1500, rxHz: 1840 });
  await startAudio(page);
  // A few seconds of waterfall from the mock microphone, then the decodes.
  await page.waitForTimeout(6000);
  const now = await phase(page, 2, 10);
  await inject(page, now - 2 * SLOT, SLOT_EVEN);
  await inject(page, now - SLOT, SLOT_ODD);
  const toYou = rowOf(page, '9V1NE OE3OGC JN88');
  await expect(toYou).toBeVisible();
  const list = page.getByTestId('decode-list');
  await list.evaluate((el) => el.scrollTo({ top: 0 }));
  const top = await topOf(page.getByRole('button', { name: /^Change band/ }));
  await save(page, 'operate-decodes', band(page, top - 8, await bottomOf(rowOf(page, 'OE3OGC 9V1DE OJ11'))), [
    mid(page.getByTestId('tx-marker')),
    mid(page.getByTestId('rx-marker')),
    mid(list.locator('.slot-bar').first()),
    mid(toYou, 0.55),
    mid(rowOf(page, 'CQ AB4SS EM73'), 0.55),
    { target: page.getByRole('radio', { name: /^All/ }), fx: 1, fy: 0, dx: -2, dy: -2 },
    { target: page.getByRole('button', { name: 'Save slot' }), fx: 0, fy: 0, dx: 2, dy: -2 },
  ]);
});

test('Getting started: Change band', async ({ page }) => {
  await openApp(page, '#/operate');
  await page.getByRole('button', { name: /^Change band/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Change band' });
  await expect(sheet).toBeVisible();
  await page.waitForTimeout(500);
  const note = sheet.getByText(/can.t read the radio.s dial/);
  await save(page, 'change-band', band(page, (await topOf(sheet)) - 4, (await topOf(note)) - 4), [
    { target: sheet.getByText('20m', { exact: true }), fx: 1, fy: 0, dx: 20, dy: -6, text: true },
    below(sheet.getByText('FT8', { exact: true })),
    after(sheet.getByText('Hound', { exact: true })),
    after(sheet.getByText('Set the radio to')),
  ]);
});

test('Logging: the log and a QSO', async ({ page }) => {
  await page.clock.setFixedTime(FIXED_TIME);
  await openApp(page, '#/log', {}, guideLog());
  const row = page.locator('button.lr-main', { hasText: 'AB4SS' }).first();
  await expect(row).toBeVisible();
  const rows = page.locator('button.lr-main');
  await save(page, 'log', band(page, (await topOf(page.getByRole('heading', { level: 1, name: 'Log' }))) - 12, await bottomOf(rows.nth(2))), [
    end(page.getByRole('searchbox')),
    below(page.getByRole('button', { name: 'Add QSO' })),
    below(page.getByRole('button', { name: 'Export ADIF' })),
    end(page.getByRole('button', { name: /^Send 1 QSO/ })),
    { target: row, fx: 0.42, fy: 0.3 },
  ]);
  await page.locator('.guide-callout').evaluateAll((els) => els.forEach((e) => e.remove()));
  await row.click();
  const sheet = page.getByRole('dialog', { name: 'Edit QSO' });
  await expect(sheet).toBeVisible();
  await page.waitForTimeout(500);
  const saveButton = sheet.getByRole('button', { name: 'Save QSO' });
  await save(page, 'log-qso', band(page, (await topOf(sheet)) + 8, (await bottomOf(saveButton)) + 20), [
    mid(sheet.getByText('Callsign', { exact: true }), 2.2),
    after(sheet.getByText(/^Part of the activation/)),
    after(sheet.getByText('Wavelog', { exact: true })),
    below(saveButton),
  ]);
});

test('Activations: an activation under way', async ({ page }) => {
  await page.clock.setFixedTime(FIXED_TIME);
  await openApp(page, '#/spots', { features: { activations: true, potaSpots: false, clusterSpots: false } }, guideLog());
  await page.waitForTimeout(500);
  const endButton = page.getByRole('button', { name: /^End activation/ });
  await save(page, 'activation', band(page, (await topOf(page.getByRole('heading', { level: 1, name: 'Spots' }))) - 12, (await bottomOf(endButton)) + 22), [
    after(page.getByText('POTA SG-0014', { exact: true }).first()),
    mid(page.locator('[role=progressbar], progress').first()),
    after(page.getByText(/^UTC day ends/)),
    after(page.getByText(/^By band/)),
    end(page.getByText('After the activation', { exact: true })),
    below(page.getByRole('button', { name: 'Edit activation' })),
    below(endButton),
  ]);
});

test('Contest exchange: the exchange and what goes out', async ({ page }) => {
  await openApp(page, '#/settings/ft8', { grid: 'OJ11VI', exchange: '1D WI', exchangeSerial: 13 });
  const head = page.locator('#exchange-head');
  // The section under the bar, 16 pt below it.
  const barBottom = await bottomOf(page.getByRole('heading', { level: 1, name: 'FT8 and FT4' }));
  await head.evaluate((el, y) => {
    let s: HTMLElement | null = el.parentElement;
    while (s && !(s.scrollHeight > s.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(s).overflowY))) s = s.parentElement;
    const scroller = s ?? (document.scrollingElement as HTMLElement);
    scroller.scrollBy(0, el.getBoundingClientRect().top - y);
  }, barBottom + 24);
  await page.waitForTimeout(300);
  const howItWorks = page.getByRole('link', { name: 'How it works' });
  await save(page, 'contest-exchange', band(page, (await topOf(head)) - 8, (await bottomOf(howItWorks)) + 4), [
    after(page.getByText('Exchange', { exact: true })),
    after(page.getByText('Class and section', { exact: true })),
    after(page.getByText('Next serial number', { exact: true })),
    after(page.getByText('Field Day', { exact: true })),
  ]);
});

test('WSPR: spots and the beacon', async ({ page }) => {
  await openApp(page, '#/operate', { mode: 'WSPR' });
  await startAudio(page);
  await page.waitForTimeout(4000);
  const slot = Math.floor(Date.now() / 120_000) * 120_000;
  const spots = [
    ['AB4SS', 'EM73', 37, -23, 1462],
    ['OE3OGC', 'JN88', 30, -26, 1531],
  ] as const;
  const decodes = spots.map(([call, grid, dbm, snr, hz]) => ({ text: `${call} ${grid} ${dbm}`, freq_hz: hz, dt_s: 0.2, drift_hz_per_s: 0, snr_db: snr }));
  await page.evaluate(([s, ds]) => window.__rr73!.wsprDecoded(s as number, ds as never), [slot - 120_000, decodes] as const);
  await page.waitForTimeout(500);
  const list = page.getByTestId('spot-list');
  const rows = list.locator('button.sr');
  const top = await topOf(page.getByRole('button', { name: /^Change band/ }));
  await save(page, 'wspr', band(page, top - 8, (await bottomOf(rows.last())) + 4), [
    mid(page.getByTestId('tx-marker')),
    mid(list.locator('.slot-bar, .sbar').first(), 0.75),
    mid(rows.first(), 0.41),
  ]);
});

test('RTTY: tuning, the text and the QSO strip', async ({ page }) => {
  await openApp(page, '#/operate', { mode: 'RTTY', myName: 'AMON', myQth: 'SINGAPORE' });
  await startAudio(page);
  await page.evaluate(() => {
    window.__rr73!.rttyDeaf();
    window.__rr73!.rttyTune(1612);
    window.__rr73!.rttySignal(-6, true);
  });
  for (const [text, kinds] of [
    ['CQ CQ DE OE3OGC OE3OGC K\n', 'r'],
    ['OE3OGC DE 9V1DE 9V1DE K\n', 'r'],
    ['9V1DE DE OE3OGC 599 599 TU\n', 'r'],
    ['CQ CQ DE AB4SS AB4SS K\n', 'r'],
    ['AB4SS DE 9V1NE 9V1NE K\n', 't'],
    ['9V1NE DE AB4SS TU UR 599 599 NAME JIM JIM QTH TENNESSEE K\n', 'r'],
  ] as const)
    await page.evaluate(([t, k]) => window.__rr73!.rttyText(t, k.repeat(t.length)), [text, kinds] as const);
  const text = page.getByTestId('rx-text');
  await text.locator('[data-call="AB4SS"]').last().click();
  await page.waitForTimeout(500);
  const bar = txBar(page);
  await save(page, 'rtty', band(page, (await topOf(page.locator('main canvas'))) - 2, await bottomOf(bar.locator('[data-id=halt]')) + 16), [
    mid(page.getByTestId('pair-marker')),
    below(page.getByRole('button', { name: /^AFC/ })),
    below(page.getByRole('button', { name: /45\.45/ })),
    { target: text.locator('[data-call="AB4SS"]').nth(1), fx: 1, dx: 46 },
    above(page.getByText('Call', { exact: true }).first()),
    end(page.getByRole('textbox', { name: /send/i })),
    { target: page.getByRole('toolbar', { name: 'Macros' }).getByRole('button').first(), fx: 1, fy: 0, dx: -2, dy: 2 },
    below(bar.getByRole('button', { name: 'Log QSO' })),
  ], 0.75);
});

test('Web SDR: a relay and a receiver', async ({ page }) => {
  await routeRelay(page);
  // The guide names no real receiver: two receivers of its own, in place of the stand-in's.
  const receivers = [
    { id: 'stand-in', kind: 'kiwisdr', name: 'Rooftop receiver', location: 'Singapore', grid: 'OJ11' },
    { id: 'second', kind: 'kiwisdr', name: 'Club receiver', location: 'Johor Bahru', grid: 'OJ01' },
  ];
  await page.route(`${RELAY_SET_UP.base}/v1/sdr/receivers`, (route) =>
    route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, contentType: 'application/json', body: JSON.stringify({ receivers }) }),
  );
  await insets(page);
  await page.goto('./');
  await seed(page, { ...emptySeed(), kv: [{ key: 'relay', value: { ...RELAY_SET_UP, receiverName: receivers[0].name } }] });
  await page.waitForFunction(() => !!window.__rr73);
  await page.evaluate((s) => window.__rr73!.settings(s as never), STATION);
  await page.goto('./#/settings/sdr');
  await page.locator('main h1:visible').first().waitFor();
  await page.waitForTimeout(800);
  const foot = page.getByText(/^Other listeners/);
  await save(page, 'web-sdr', band(page, (await topOf(page.getByRole('heading', { level: 1, name: 'Web SDR' }))) - 12, (await bottomOf(foot)) + 8), [
    mid(page.getByText('Receive from a web SDR', { exact: true }), 1.25),
    after(page.getByText('Rooftop receiver', { exact: true })),
  ]);
});

test('Practice band: the scenarios', async ({ page }) => {
  await insets(page);
  await page.goto('./');
  await seed(page, { ...emptySeed(), kv: [{ key: 'practice', value: { on: true } }] });
  await page.waitForFunction(() => !!window.__rr73);
  await page.evaluate((s) => window.__rr73!.settings(s as never), STATION);
  await page.goto('./#/operate');
  await page.locator('main h1:visible').first().waitFor();
  await txBar(page).getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: /^Practice scenario/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Practice scenario' });
  await expect(sheet).toBeVisible();
  await page.waitForTimeout(500);
  await save(page, 'practice-scenario', band(page, await topOf(sheet), await bottomOf(sheet.getByRole('radio', { name: /^Activation callers/ }))), []);
});

test('Timing: the clock and decode times', async ({ page }) => {
  await openApp(page, '#/operate');
  await startAudio(page);
  await page.goto('./#/settings/radio/timing');
  await page.locator('main h1:visible').first().waitFor();
  await page.waitForTimeout(1500);
  const title = (t: string) => page.getByText(t, { exact: true });
  await save(page, 'timing', band(page, (await topOf(page.getByRole('heading', { level: 1, name: 'Radio and audio' }))) - 12, (await bottomOf(title('Your Tx, heard back'))) + 26), [
    after(title('Decode time')),
    after(title('Phone clock')),
    end(title('Correct Tx timing')),
    after(title('Input offset')),
    after(title('Your Tx, heard back')),
  ]);
});

test('Your radio: Rig control', async ({ baseURL }) => {
  // Rig control needs Web Serial: Chromium, at the same size.
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ baseURL, viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, colorScheme: 'light' });
    const page = await context.newPage();
    await insets(page);
    await page.goto('./');
    await page.waitForFunction(() => !!window.__rr73);
  await page.evaluate((s) => window.__rr73!.settings(s as never), STATION);
    await page.goto('./#/settings/rig');
    await page.locator('main h1:visible').first().waitFor();
    await page.getByRole('switch', { name: /^Rig control/ }).check();
    await page.waitForTimeout(500);
    const title = (t: string) => page.getByText(t, { exact: true });
    await save(page, 'rig-control', band(page, (await topOf(page.getByRole('heading', { level: 1, name: 'Rig control' }))) - 12, (await bottomOf(title('Test keying'))) + 8), [
      { target: page.getByRole('switch', { name: /^Rig control/ }), fx: 0, dx: -20 },
      after(title('Icom IC-705')),
      after(title('Baud rate')),
      after(title('Connect radio')),
      after(title('Key the radio with CAT')),
      after(title('Test keying')),
    ]);
  } finally {
    await browser.close();
  }
});
