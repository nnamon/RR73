// Accessibility: axe-core (WCAG 2.0 to 2.2, A and AA) on every screen and sheet in both themes.
// Dark adds the colour contrast of the dark theme. audio.spec.ts scans the Save slot sheet, which
// needs recorded slots, and decode.spec.ts the list with decodes.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { LOG_SHEETS, SCREENS, open } from './screens';

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  return r.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.length}× ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
}

// settings-features is Settings scrolled to Optional features: the same page as settings.
const PAGES = SCREENS.filter((s) => s.name !== 'settings-features');

for (const theme of ['light', 'dark'] as const) {
  for (const s of PAGES) {
    test(`${s.name} in ${theme}`, async ({ page }) => {
      await open(page, s.path, theme, s.seed, s.features, s.practice, s.relay, s.psk, s.heard);
      expect(await axe(page)).toEqual([]);
    });
  }

  test(`band sheet in ${theme}`, async ({ page }) => {
    await open(page, '#/operate', theme);
    await page.getByRole('button', { name: /^Change band/ }).click();
    await expect(page.getByRole('dialog', { name: 'Change band' })).toBeVisible();
    expect(await axe(page)).toEqual([]);
  });

  for (const c of LOG_SHEETS) {
    test(`${c.name} sheet in ${theme}`, async ({ page }) => {
      await open(page, c.path, theme, c.seed, c.features);
      await c.open(page);
      await expect(page.getByRole('dialog', { name: c.title })).toBeVisible();
      expect(await axe(page)).toEqual([]);
    });
  }

  test(`QSO sheet with errors and the logged notice in ${theme}`, async ({ page }) => {
    await open(page, '#/log', theme);
    await page.getByRole('button', { name: 'Add QSO' }).click();
    const sheet = page.getByRole('dialog', { name: 'Add QSO' });
    await sheet.getByRole('textbox', { name: 'Their grid' }).fill('QF5');
    await sheet.getByRole('button', { name: 'Add QSO' }).click();
    await expect(sheet.getByRole('alert')).toBeVisible();
    expect(await axe(page)).toEqual([]);
    await sheet.getByRole('textbox', { name: 'Callsign' }).fill('VK2ESN');
    await sheet.getByRole('textbox', { name: 'Their grid' }).fill('QF56');
    await sheet.getByRole('button', { name: 'Add QSO' }).click();
    await expect(page.getByTestId('log-notice')).toBeVisible();
    expect(await axe(page)).toEqual([]);
  });

  test(`tune sheet in ${theme}`, async ({ page }) => {
    await open(page, '#/settings/radio', theme);
    await page.getByRole('button', { name: /^Tune/ }).click();
    await expect(page.getByRole('dialog', { name: 'Tuning' })).toBeVisible();
    expect(await axe(page)).toEqual([]);
  });
}
