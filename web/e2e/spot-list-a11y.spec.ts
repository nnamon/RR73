// SpotList accessibility: axe-core (WCAG 2.0 to 2.2, A and AA) on every state in both themes, in
// the chromium project that runs every a11y.spec.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { openSpotList, STATES } from './spot-list/harness';

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  return r.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.length}× ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
}

for (const theme of ['light', 'dark'] as const) {
  for (const state of STATES) {
    test(`spot list ${state} in ${theme}`, async ({ page }) => {
      await openSpotList(page, state, theme);
      expect(await axe(page)).toEqual([]);
    });
  }

  test(`spot list with every chip pressed in ${theme}`, async ({ page }) => {
    await openSpotList(page, 'list', theme);
    for (const name of ['DX', 'My bands', 'New only']) await page.getByRole('button', { name, exact: true }).click();
    await page.locator('li.spot button.pick').first().click();
    expect(await axe(page)).toEqual([]);
  });
}

test('rows and chips say what they are and their state', async ({ page }) => {
  await openSpotList(page, 'list', 'light');
  await expect(page.getByRole('group', { name: 'Show spots' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'FT8 and FT4', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const list = page.getByRole('list', { name: 'Spots, newest first' });
  await expect(list.getByRole('listitem')).toHaveCount(4);
  const first = list.getByRole('button', { name: /^JE1QEV, New park, 430\.512 MHz FT8, POTA JP-1834, Chichibu Muse Prefectural Park, 1 minute ago$/ });
  await expect(first).toHaveAttribute('aria-expanded', 'false');
  await first.focus();
  await page.keyboard.press('Enter');
  await expect(first).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Go to JE1QEV' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('body')).toHaveAttribute('data-go', 'JE1QEV');
});
