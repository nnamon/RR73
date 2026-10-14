// KiwiSDRs of the operator's own in Settings › Web SDR, against a stand-in QSP relay
// (relay-stand-in.ts) in Chromium: offered only where the relay allows them, added by address,
// started by address, refused for a private address with the relay's answer, removed with Undo.
// No request reaches a real server; the stream's WebSocket is held open by the test.
import { expect, test, type Page } from '@playwright/test';
import { RELAY_BASE, RECEIVERS, routeRelay } from './relay-stand-in';

let escaped: string[] = [];

test.beforeEach(async ({ page, baseURL }) => {
  escaped = [];
  const origin = new URL(baseURL!).origin;
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.protocol === 'data:' || u.protocol === 'blob:' || u.origin === new URL(RELAY_BASE).origin) return;
    if (u.origin !== origin || (r.method() !== 'GET' && r.method() !== 'HEAD')) escaped.push(`${r.method()} ${r.url()}`);
  });
  await page.route((url) => url.origin !== origin, (route) => route.abort());
  // The stream connects to nothing: it stays open with no audio.
  await page.routeWebSocket(/relay\.test/, () => undefined);
});

test.afterEach(() => {
  expect(escaped, 'requests that left for a real server').toEqual([]);
});

async function addRelay(page: Page) {
  await page.goto('./#/settings/relay');
  await page.getByRole('button', { name: 'Add relay' }).click();
  const address = page.getByRole('textbox', { name: 'Address' });
  await address.fill(RELAY_BASE);
  await address.press('Enter');
  await expect(page.getByRole('radio', { name: /^relay\.test/ })).toBeChecked();
  await page.goto('./#/settings/sdr');
  await expect(page.getByRole('radio', { name: new RegExp(`^${RECEIVERS[0].name}`) })).toBeVisible();
}

/** The receiver in use as stored, once the last write has landed. */
function storedReceiver(page: Page): Promise<unknown> {
  return page.evaluate(async () => {
    const d = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('rr73');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const row = await new Promise<{ value?: { receiver?: unknown } } | undefined>((resolve) => {
      const g = d.transaction('kv').objectStore('kv').get('relay');
      g.onsuccess = () => resolve(g.result as { value?: { receiver?: unknown } } | undefined);
    });
    d.close();
    return row?.value?.receiver;
  });
}

async function addKiwi(page: Page, text: string) {
  await page.getByRole('button', { name: 'Add KiwiSDR' }).click();
  const address = page.getByRole('textbox', { name: 'Address' });
  await address.fill(text);
  await address.press('Enter');
}

test('a relay that takes only its own receivers offers no Add KiwiSDR', async ({ page }) => {
  await routeRelay(page);
  const about = page.waitForResponse((r) => r.url().endsWith('/qsp/about'));
  await addRelay(page);
  await about;
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await expect(page.getByRole('button', { name: 'Add KiwiSDR' })).toHaveCount(0);
});

test('adds KiwiSDRs by address, starts them by address, shows a refusal and removes one with Undo', async ({ page }) => {
  const calls = await routeRelay(page, { userReceivers: true });
  await addRelay(page);

  await addKiwi(page, 'kiwi example');
  await expect(page.getByRole('alert')).toHaveText('That is not a receiver address. Enter its host and port, such as kiwi.example.org:8073.');
  await page.getByRole('textbox', { name: 'Address' }).fill('');
  await page.getByRole('textbox', { name: 'Address' }).press('Enter');

  // A private address: the relay refuses the session, and Settings says why.
  await addKiwi(page, '192.168.1.50');
  const lan = page.getByRole('radio', { name: /^192\.168\.1\.50 Added by you/ });
  await expect(lan).toBeChecked();
  await page.getByRole('switch', { name: /^Receive from a web SDR/ }).check();
  await expect(page.getByRole('status').filter({ hasText: 'public' })).toHaveText('192.168.1.50 is not on the public internet. This relay connects only to public receivers.');
  const refused = calls.find((c) => c.method === 'POST' && c.path === '/v1/sdr/sessions');
  expect(refused?.body).toMatchObject({ custom: { kind: 'kiwisdr', host: '192.168.1.50', port: 8073 } });

  // A pasted receiver URL, on its own port: the session moves to it.
  await addKiwi(page, 'http://kiwi.example.org:8074/?f=14074usb');
  await expect(page.getByRole('radio', { name: /^kiwi\.example\.org:8074 Added by you/ })).toBeChecked();
  await expect.poll(() => calls.filter((c) => c.method === 'POST' && c.path === '/v1/sdr/sessions').length).toBe(2);
  const started = calls.filter((c) => c.method === 'POST' && c.path === '/v1/sdr/sessions')[1];
  expect(started.body).toMatchObject({ custom: { kind: 'kiwisdr', host: 'kiwi.example.org', port: 8074 }, dialHz: 14074000 });
  await expect(page.getByText('Connecting to kiwi.example.org:8074')).toBeVisible();

  // Removing the one in use stops the web SDR; Undo brings it back, kept after a reload.
  await page.getByRole('button', { name: 'Remove receiver' }).click();
  await expect(page.getByRole('radio', { name: /^kiwi\.example\.org/ })).toHaveCount(0);
  await expect(page.getByText(/^Receiving from|^Connecting to/)).toHaveCount(0);
  const notice = page.getByTestId('log-notice');
  await expect(notice).toContainText('Removed kiwi.example.org:8074');
  await notice.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('radio', { name: /^kiwi\.example\.org:8074/ })).toBeChecked();
  await expect.poll(() => storedReceiver(page)).toBe('kiwisdr://kiwi.example.org:8074');
  await page.reload();
  await expect(page.getByRole('radio', { name: /^kiwi\.example\.org:8074/ })).toBeChecked();
  await expect(page.getByRole('radio', { name: /^192\.168\.1\.50/ })).not.toBeChecked();
});
