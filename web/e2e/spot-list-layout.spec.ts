// SpotList on iPhone viewports in WebKit (the webkit-375x667 and webkit-393x852 projects run every
// layout.spec), light and dark: nothing overflows sideways, every control is at least 44 px, rows
// are at least 56 px with the callsign in bold monospace, and each state is captured.
import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { openSpotList, STATES } from './spot-list/harness';

const SHOTS = fileURLToPath(new URL('../test-results/screens', import.meta.url));

/** Elements in main wider than the screen or off its left edge. */
function overflow(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    const out: string[] = [];
    if (document.documentElement.scrollWidth > w) out.push('document');
    for (const el of document.querySelectorAll<HTMLElement>('main *')) {
      const r = el.getBoundingClientRect();
      if (r.width && (r.right > w + 0.5 || r.left < -0.5)) out.push(`${el.tagName.toLowerCase()}.${el.className} ${Math.round(r.left)}..${Math.round(r.right)}`);
    }
    return out;
  });
}

/** Buttons in main smaller than 44 by 44 px. */
function smallTargets(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('main button')].flatMap((el) => {
      const r = el.getBoundingClientRect();
      return r.height < 43.5 || r.width < 43.5 ? [`"${el.textContent?.trim().slice(0, 30)}" ${Math.round(r.width)}x${Math.round(r.height)}`] : [];
    }),
  );
}

/** Rows shorter than 56 px. */
function shortRows(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('li.spot')].flatMap((li) => {
      const h = li.getBoundingClientRect().height;
      return h < 55.5 ? [`${li.querySelector('.call')?.textContent} ${h}`] : [];
    }),
  );
}

for (const theme of ['light', 'dark'] as const) {
  for (const state of STATES) {
    test(`spot list ${state} in ${theme}`, async ({ page }, info) => {
      await openSpotList(page, state, theme);
      expect(await overflow(page)).toEqual([]);
      expect(await smallTargets(page)).toEqual([]);
      expect(await shortRows(page)).toEqual([]);
      await page.screenshot({ path: `${SHOTS}/${info.project.name}-${theme}-spotlist-${state}.png` });
    });
  }

  test(`spot list colours come from the ${theme} tokens`, async ({ page }) => {
    await openSpotList(page, 'open', theme);
    const colours = await page.evaluate(() => {
      const bg = (sel: string) => getComputedStyle(document.querySelector(sel)!).backgroundColor;
      return { group: bg('ul.group'), page: getComputedStyle(document.body).backgroundColor, go: bg('button.go') };
    });
    expect(colours).toEqual(
      theme === 'light'
        ? { group: 'rgb(255, 255, 255)', page: 'rgb(242, 243, 246)', go: 'rgb(40, 81, 216)' }
        : { group: 'rgb(21, 24, 29)', page: 'rgb(11, 13, 16)', go: 'rgb(63, 107, 232)' },
    );
  });
}

test('rows are at least 56 px, with the callsign in bold monospace', async ({ page }) => {
  await openSpotList(page, 'all', 'light');
  const rows = page.locator('li.spot');
  expect(await rows.count()).toBeGreaterThan(10);
  const call = await page.locator('li.spot .call').first().evaluate((el) => {
    const s = getComputedStyle(el);
    return { weight: s.fontWeight, family: s.fontFamily, size: s.fontSize };
  });
  expect(call.weight).toBe('700');
  expect(call.family).toContain('monospace');
  expect(call.size).toBe('17px');
  const heights = await rows.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
  expect(Math.min(...heights)).toBeGreaterThanOrEqual(56);
});

test('tapping a row opens it, and Go hands over the spot', async ({ page }) => {
  await openSpotList(page, 'list', 'light');
  const row = page.locator('li.spot', { hasText: 'KC5JEC' });
  await row.locator('button.pick').tap();
  await expect(row.locator('button.pick')).toHaveAttribute('aria-expanded', 'true');
  await expect(row.locator('.by')).toHaveText('Spotted by WE9V (RBN) at 05:52 UTC · −16 dB');
  const go = row.getByRole('button', { name: 'Go to KC5JEC' });
  await expect(go).toBeVisible();
  await go.tap();
  await expect(page.locator('body')).toHaveAttribute('data-go', 'KC5JEC');
});

test('chips filter the list', async ({ page }) => {
  await openSpotList(page, 'list', 'light');
  const rows = page.locator('li.spot');
  await expect(rows).toHaveCount(4);
  await page.getByRole('button', { name: 'DX', exact: true }).tap();
  await expect(page.getByRole('button', { name: 'DX', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const withDx = await rows.count();
  expect(withDx).toBeGreaterThan(4);
  await page.getByRole('button', { name: 'FT8 and FT4', exact: true }).tap();
  expect(await rows.count()).toBeGreaterThan(withDx);
  await page.getByRole('button', { name: 'My bands', exact: true }).tap();
  const bands = await page.locator('li.spot .freq').allTextContents();
  expect(bands.length).toBeGreaterThan(0);
  const onMyBands = (mhz: number) => (mhz >= 14 && mhz <= 14.35) || (mhz >= 7 && mhz <= 7.3) || (mhz >= 3.5 && mhz <= 4) || (mhz >= 420 && mhz <= 450);
  expect(bands.filter((f) => !onMyBands(Number(f.split(' ')[0])))).toEqual([]);
});
