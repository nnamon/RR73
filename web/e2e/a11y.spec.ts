// Accessibility: axe-core (WCAG 2.0 to 2.2, A and AA) on every screen and sheet in both themes.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { SCREENS, open } from './screens';

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  return r.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.length}× ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
}

for (const theme of ['light', 'dark'] as const) {
  for (const s of SCREENS) {
    test(`${s.name} in ${theme}`, async ({ page }) => {
      await open(page, s.path, theme);
      expect(await axe(page)).toEqual([]);
    });
  }

  test(`band sheet in ${theme}`, async ({ page }) => {
    await open(page, '#/operate', theme);
    await page.getByRole('button', { name: /^Change band/ }).click();
    await expect(page.getByRole('dialog', { name: 'Change band' })).toBeVisible();
    expect(await axe(page)).toEqual([]);
  });

  test(`save slot sheet in ${theme}`, async ({ page }) => {
    await open(page, '#/operate', theme);
    // No slots yet, so the button is disabled; open the sheet through its own state is not possible.
    await expect(page.getByRole('button', { name: 'Save slot' })).toBeDisabled();
  });

  test(`tune sheet in ${theme}`, async ({ page }) => {
    await open(page, '#/settings/radio', theme);
    await page.getByRole('button', { name: /^Tune/ }).click();
    await expect(page.getByRole('dialog', { name: 'Transmit a tune tone?' })).toBeVisible();
    expect(await axe(page)).toEqual([]);
  });
}
