// The built service worker: what it caches for offline use, and how a new version takes over.
// A new version waits for the app's SKIP_WAITING, so the running build keeps every file it may
// still load; versions up to 0.5.0 never send it, and the handover script lets the new worker
// take over from those at once (public/sw-handover.js).
import { expect, test } from '@playwright/test';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DIST = fileURLToPath(new URL('../dist/', import.meta.url));
const sw = () => readFileSync(`${DIST}sw.js`, 'utf8');
const precached = () => [...new Set([...sw().matchAll(/url:"([^"]+)"/g)].map((m) => m[1]))];

test('a new version waits for the app before it takes over', () => {
  const text = sw();
  expect(text).toContain('importScripts("sw-handover.js")');
  expect(text).toMatch(/"SKIP_WAITING"/);
  // skipWaiting only in answer to SKIP_WAITING: nowhere else.
  const handler = /self\.addEventListener\("message",\w+=>\{[^}]*SKIP_WAITING[^}]*\}\)/.exec(text);
  expect(handler).not.toBeNull();
  expect(text.replace(handler![0], '')).not.toContain('skipWaiting');
});

test('the precache holds the app, the decoder and the country file, and stays small', () => {
  const urls = precached();
  for (const pattern of [/^index\.html$/, /^assets\/index-[\w-]+\.js$/, /^assets\/decoder\.worker-[\w-]+\.js$/, /^assets\/waterfall\.worker-[\w-]+\.js$/, /^assets\/capture\.worklet-[\w-]+\.js$/, /^assets\/rr73_wasm_bg-[\w-]+\.wasm$/, /^sw-handover\.js$/]) {
    expect(urls.some((u) => pattern.test(u)), String(pattern)).toBe(true);
  }
  expect(urls.filter((u) => u.endsWith('.map'))).toEqual([]);
  // The guide's screenshots (docs/guide/img), so its pages read offline.
  expect(urls.some((u) => /^assets\/operate-tx-[\w-]+\.webp$/.test(u))).toBe(true);
  // Reference data (tools/refdata): the country file and the manifest when the build has them,
  // and nothing that loads only with a feature switched on.
  const data = ['data/manifest.json', 'data/cty.json'].filter((u) => existsSync(`${DIST}${u}`));
  expect(urls.filter((u) => u.startsWith('data/')).sort()).toEqual(data.sort());
  const bytes = urls.reduce((n, u) => n + statSync(`${DIST}${u}`).size, 0);
  test.info().annotations.push({ type: 'precache', description: `${urls.length} files, ${(bytes / 1e6).toFixed(2)} MB` });
  // 3.6 MB: the decoder with experiment 0012's retries and the 3 bundled fonts (121 kB) came to
  // 3.02 MB, and the guide's 13 screenshots (docs/guide/img) add 0.42 MB.
  expect(bytes).toBeLessThan(3.6e6);
});

test.describe('in the browser', () => {
  test.use({ serviceWorkers: 'allow' });

  test('the first visit is controlled at once, and the worker says it waits for the app', async ({ page }) => {
    await page.goto('./');
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 30_000 });
    const answer = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const channel = new MessageChannel();
          channel.port1.onmessage = (e) => resolve(e.data);
          navigator.serviceWorker.controller!.postMessage({ type: 'RR73_HANDOVER' }, [channel.port2]);
          setTimeout(() => resolve(null), 5000);
        }),
    );
    expect(answer).toBe('waits');
    await expect(page.getByRole('heading', { level: 1, name: 'Operate' })).toBeAttached();
  });
});
