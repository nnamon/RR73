// The guide's annotated screenshots (docs/guide/img/*.webp), in the guide-shots project only
// (RR73_GUIDE_SHOTS=1; docs/testing.md). Operate runs as on an iPhone at 393 x 852 in WebKit, light
// theme: WebKit's mock microphone runs the audio and the e2e hooks supply the decodes, so the QSO
// under way is the app's own sequencer at work. Numbered circles go on top of the page before the
// capture, matching the numbered legend under each image in the page's Markdown. Chromium encodes
// the WebP, which WebKit cannot.
import { chromium, expect, test, type Locator, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SLOT, d, inject, openOperate, phase, rowOf } from './operate-checks';

const IMG = fileURLToPath(new URL('../../docs/guide/img/', import.meta.url));
/** The largest file the guide takes, bytes (guide.test.ts). */
const MAX_BYTES = 40_000;

interface Callout {
  target: Locator;
  /** Where the circle sits: above the start of a line of text, or centred on a button's bottom edge. */
  at: 'above' | 'below';
}

/** Puts numbered circles on the page, 1 first, styled as GuidePage's legend. */
async function addCallouts(page: Page, callouts: Callout[]) {
  const spots: { x: number; y: number }[] = [];
  for (const c of callouts) {
    const box = (await c.target.boundingBox())!;
    spots.push(c.at === 'above' ? { x: box.x + 24, y: box.y - 14 } : { x: box.x + box.width / 2, y: box.y + box.height + 4 });
  }
  await page.evaluate((list) => {
    for (const [i, s] of list.entries()) {
      const el = document.createElement('span');
      el.className = 'guide-callout';
      el.textContent = String(i + 1);
      Object.assign(el.style, {
        position: 'fixed',
        zIndex: '1000',
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
      document.body.append(el);
    }
  }, spots);
}

/** The PNG as WebP, at the highest quality that stays under MAX_BYTES. */
async function toWebp(png: Buffer): Promise<Buffer> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    for (const q of [0.85, 0.8, 0.75, 0.7, 0.65, 0.6, 0.5, 0.4]) {
      const b64 = await page.evaluate(
        async ([src, quality]) => {
          const img = new Image();
          img.src = src as string;
          await img.decode();
          const c = document.createElement('canvas');
          c.width = img.naturalWidth;
          c.height = img.naturalHeight;
          c.getContext('2d')!.drawImage(img, 0, 0);
          const url = c.toDataURL('image/webp', quality as number);
          if (!url.startsWith('data:image/webp')) throw new Error('No WebP encoder');
          return url.slice(url.indexOf(',') + 1);
        },
        [`data:image/png;base64,${png.toString('base64')}`, q] as const,
      );
      const out = Buffer.from(b64, 'base64');
      if (out.length < MAX_BYTES) return out;
    }
    throw new Error('Image stays over the size limit: crop it smaller');
  } finally {
    await browser.close();
  }
}

/** Captures `clip` of the page as docs/guide/img/<name>.webp. */
async function save(page: Page, name: string, clip: { x: number; y: number; width: number; height: number }) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const png = await page.screenshot({ clip });
  const webp = await toWebp(png);
  mkdirSync(IMG, { recursive: true });
  writeFileSync(`${IMG}${name}.webp`, webp);
  console.log(`${name}.webp ${webp.length} bytes`);
}

test('Making QSOs: the transmit controls and status line in a QSO under way', async ({ page }) => {
  test.setTimeout(180_000);
  await openOperate(page, 'light');
  const bar = page.getByRole('region', { name: 'Transmit' });

  // K1ABC calls CQ; a double-tap answers it in the next slot of the other parity.
  const heard = await phase(page, 2, 5);
  await inject(page, heard - SLOT, [d('CQ K1ABC FN42', -12, 1210, 0.2), d('CQ JA1KXM PM95', -6, 1840, 0.1), d('JA1KXM K1ABC -09', -15, 640, 0.3)]);
  await rowOf(page, 'CQ K1ABC FN42').evaluate((el: HTMLElement) => {
    el.click();
    el.click();
  });
  await expect(bar.getByRole('button', { name: 'On air' })).toBeVisible({ timeout: 40_000 });
  const ours = await page.evaluate(() => Date.now() - (Date.now() % 15_000));

  // K1ABC's report in the slot after ours: Tx3 with the R-report goes next.
  await page.waitForTimeout(Math.max(0, ours + SLOT + 500 - Date.now()));
  await inject(page, ours + SLOT, [d('9V1NE K1ABC -12', -10, 1215, 0.2), d('CQ JA1KXM PM95', -7, 1840, 0.1)]);
  await expect(bar.getByText(/^Tx3 · K1ABC 9V1NE R-10/)).toBeVisible();
  await page.waitForTimeout(400);

  const button = (id: string) => bar.locator(`[data-id=${id}]`);
  await addCallouts(page, [
    { target: bar.locator('.status .msg'), at: 'above' },
    { target: bar.locator('.status .aside'), at: 'above' },
    { target: button('tx'), at: 'below' },
    { target: button('cq'), at: 'below' },
    { target: button('hunt'), at: 'below' },
    { target: button('more'), at: 'below' },
    { target: button('halt'), at: 'below' },
  ]);
  const top = (await bar.boundingBox())!.y;
  const { width, height } = page.viewportSize()!;
  // Room above the bar for the circles over the status line.
  const y = top - 32;
  await save(page, 'operate-tx', { x: 0, y, width, height: height - y });
});
