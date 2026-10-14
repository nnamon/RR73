// Web SDR receive end to end in Chromium, with no microphone. Settings › Relay and Settings › Web
// SDR are set up against a stand-in QSP relay (page.route and page.routeWebSocket). The relay
// streams e2e/fixtures/ft8-loop.wav in QSP's frames (docs/design/qsp.md), each stamped with the UTC
// of its first sample. The loop restarts on every slot boundary, so each slot holds one copy of
// each message at the fixture's DT. The app plays each frame 1.5 s after its UTC and subtracts
// that delay from capture's timestamps, so the decodes show the fixture's DT. No request reaches
// a real server.
import { expect, test, type Page, type WebSocketRoute } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { loadWasm } from './wasm';
import { RECEIVERS, RELAY_BASE as BASE, RELAY_KEY as KEY, routeRelay } from './relay-stand-in';

const ME = '9V1NE';
const RECEIVER = RECEIVERS[0];
/** Samples per frame, and the rate, as QSP sends them. */
const FRAME = 512;
const RATE = 12_000;
/** How late each frame reaches the app after its last sample, ms: a receiver and a relay away. */
const LATENCY_MS = 300;

interface Truth {
  text: string;
  freq_hz: number;
  dt_s: number;
}
/** The copy of each message that starts in the first 0.2 s of the loop: one per slot. */
const COPIES = (JSON.parse(readFileSync(new URL('./fixtures/ft8-loop.json', import.meta.url), 'utf8')) as { truth: Truth[] }).truth.filter((t) => t.dt_s < 1);

/** ft8-loop.wav's samples: 12 kHz mono 16-bit, 15 s. */
function loopSamples(): Int16Array {
  const b = readFileSync(new URL('./fixtures/ft8-loop.wav', import.meta.url));
  let at = 12;
  while (at + 8 <= b.length) {
    const id = b.toString('ascii', at, at + 4);
    const size = b.readUInt32LE(at + 4);
    if (id === 'data') {
      const out = new Int16Array(size / 2);
      for (let i = 0; i < out.length; i++) out[i] = b.readInt16LE(at + 8 + 2 * i);
      return out;
    }
    at += 8 + size + (size % 2);
  }
  throw new Error('ft8-loop.wav has no data chunk');
}
const LOOP = loopSamples();

/** A QSP frame of PCM samples: version 1, encoding 0, the flags, seq, UTC in µs, count, samples. */
function frame(seq: number, utcUs: number, first: number): Buffer {
  const b = Buffer.alloc(20 + 2 * FRAME);
  b.writeUInt8(1, 0);
  b.writeUInt8(0, 1);
  b.writeUInt16BE(0, 2);
  b.writeUInt32BE(seq >>> 0, 4);
  b.writeBigInt64BE(BigInt(Math.round(utcUs)), 8);
  b.writeUInt32BE(FRAME, 16);
  for (let i = 0; i < FRAME; i++) b.writeInt16BE(LOOP[(first + i) % LOOP.length], 20 + 2 * i);
  return b;
}

/**
 * Streams the loop on frames counted from a slot boundary, each sent LATENCY_MS after its end,
 * until the page closes the stream. Playwright keeps one close handler per socket: this one.
 */
function stream(ws: WebSocketRoute, closed: () => void) {
  const slot = Math.floor(Date.now() / 15_000) * 15_000;
  const frameMs = (FRAME / RATE) * 1000;
  let k = Math.ceil((Date.now() - LATENCY_MS - slot) / frameMs);
  let seq = 0;
  ws.send(JSON.stringify({ type: 'status', state: 'streaming' }));
  const timer = setInterval(() => {
    while (slot + (k + 1) * frameMs + LATENCY_MS <= Date.now()) {
      ws.send(frame(seq++, (slot + k * frameMs) * 1000, k * FRAME));
      k++;
    }
  }, 10);
  ws.onClose(() => {
    clearInterval(timer);
    closed();
  });
}

/** The stand-in relay: its API (relay-stand-in.ts), and its stream on page.routeWebSocket. */
async function standInRelay(page: Page) {
  const calls = await routeRelay(page);
  const streams: { url: string; closed: boolean }[] = [];
  await page.routeWebSocket(`${BASE.replace('https:', 'wss:')}/**`, (ws) => {
    const s = { url: ws.url(), closed: false };
    streams.push(s);
    stream(ws, () => (s.closed = true));
  });
  return { calls, streams };
}

let escaped: string[] = [];

test.beforeEach(async ({ page, baseURL }) => {
  test.skip(!(await loadWasm()), 'The wasm package is not built (src/wasm/pkg).');
  escaped = [];
  const origin = new URL(baseURL!).origin;
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.protocol === 'data:' || u.protocol === 'blob:' || u.origin === new URL(BASE).origin) return;
    if (u.origin !== origin || (r.method() !== 'GET' && r.method() !== 'HEAD')) escaped.push(`${r.method()} ${r.url()}`);
  });
  await page.route((url) => url.origin !== origin, (route) => route.abort());
});

test.afterEach(() => {
  expect(escaped, 'requests that left for a real server').toEqual([]);
});

const rows = (page: Page) => page.getByTestId('decode-list').locator('button.dr');

test('receives from a web SDR through a relay, at the time the relay gives each sample', async ({ page }) => {
  test.setTimeout(120_000);
  const relay = await standInRelay(page);
  await page.goto('./#/settings');
  const call = page.getByRole('textbox', { name: 'Callsign' });
  await call.fill(ME);
  await call.press('Enter');

  // Settings › Relay: None, and no relay the app knows; one added by its address, then its key;
  // Test reads the relay.
  await page.getByRole('link', { name: /^Relay/ }).click();
  const relays = page.getByRole('radiogroup', { name: 'Relay' }).getByRole('radio');
  await expect(relays).toHaveCount(1);
  await expect(page.getByRole('radio', { name: 'None' })).toBeChecked();
  await page.getByRole('button', { name: 'Add relay' }).click();
  const address = page.getByRole('textbox', { name: 'Address' });
  await expect(address).toBeFocused();
  await address.fill('relay.test');
  await address.press('Enter');
  await expect(page.getByRole('alert')).toHaveText('That is not an http or https address. Enter the relay’s API base, such as https://relay.example.org/qsp.');
  await address.fill(`${BASE}/`);
  await address.press('Enter');
  await expect(address).toBeHidden();
  await expect(relays).toHaveCount(2);
  await expect(page.getByRole('radio', { name: /^relay\.test/ })).toBeChecked();
  const key = page.getByLabel('Access key');
  await key.fill(KEY);
  await key.press('Enter');
  await page.getByRole('button', { name: 'Test relay' }).click();
  await expect(page.getByRole('region', { name: 'Relay' }).getByRole('status')).toHaveText('QSP 0.16.0 · Web SDR, 2 receivers');
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('link', { name: /^Relay/ })).toContainText('relay.test');

  // Settings › Web SDR: the switch waits for a receiver; choosing one and turning it on starts audio.
  await page.getByRole('link', { name: /^Web SDR/ }).click();
  const on = page.getByRole('switch', { name: /^Receive from a web SDR/ });
  await expect(on).toBeDisabled();
  await page.getByRole('radio', { name: /^Stand-in Web-888/ }).click();
  await on.check();
  await expect(page.getByRole('region', { name: 'Web SDR' }).getByRole('status')).toHaveText('Receiving from Stand-in Web-888');
  const post = relay.calls.find((c) => c.method === 'POST')!;
  expect(post).toEqual({ method: 'POST', path: '/v1/sdr/sessions', auth: `Bearer ${KEY}`, body: { receiver: RECEIVER.id, dialHz: 14_074_000, listener: ME, encoding: 'ima-adpcm' } });
  expect(relay.streams.map((s) => s.url)).toEqual(['wss://relay.test/qsp/v1/sdr/sessions/s1/stream?ticket=t-s1']);

  // Operate: the Web SDR badge, and each message decoded at the fixture's DT and frequency.
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('link', { name: 'Operate' }).click();
  await expect(page.locator('header.top .sdr')).toHaveText('Web SDR');
  await expect(page.getByRole('timer', { name: /Receiving$/ })).toBeVisible({ timeout: 10_000 });
  const labels: string[] = [];
  for (const c of COPIES) {
    const row = rows(page).filter({ has: page.locator('.c-msg', { hasText: c.text }) }).first();
    await expect(row).toBeVisible({ timeout: 50_000 });
    const label = (await row.getAttribute('aria-label')) ?? '';
    labels.push(label);
    const m = /DT (−?[\d.]+) s, (\d+) Hz/.exec(label);
    expect(m, label).not.toBeNull();
    expect(Math.abs(Number(m![1].replace('−', '-')) - c.dt_s), label).toBeLessThanOrEqual(0.2);
    expect(Math.abs(Number(m![2]) - c.freq_hz), label).toBeLessThanOrEqual(3);
  }

  test.info().annotations.push({ type: 'decodes', description: JSON.stringify(labels) });

  // A change of band retunes the receiver.
  await page.locator('header.top').getByRole('button', { name: /^Change band/ }).click();
  await page.getByRole('dialog', { name: 'Change band' }).getByText('40m', { exact: true }).click();
  await expect.poll(() => relay.calls.filter((c) => c.method === 'PATCH').map((c) => [c.path, c.body])).toEqual([['/v1/sdr/sessions/s1', { dialHz: 7_074_000 }]]);

  // Off: the session ends at the relay and the stream closes.
  await page.goto('./#/settings/sdr');
  await page.getByRole('switch', { name: /^Receive from a web SDR/ }).uncheck();
  await expect.poll(() => relay.calls.filter((c) => c.method === 'DELETE').map((c) => c.path)).toEqual(['/v1/sdr/sessions/s1']);
  await expect.poll(() => relay.streams[0].closed).toBe(true);

  // Remove relay takes it off the list, with Undo.
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('link', { name: /^Relay/ }).click();
  await page.getByRole('button', { name: 'Remove relay' }).click();
  await expect(page.getByRole('radio', { name: 'None' })).toBeChecked();
  await expect(relays).toHaveCount(1);
  await expect(page.getByTestId('log-notice')).toContainText('Removed relay.test');
  await page.getByTestId('log-notice').getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('radio', { name: /^relay\.test/ })).toBeChecked();
  await expect(page.getByLabel('Access key')).toHaveValue(KEY);
});
