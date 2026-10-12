// The app's screens, for the layout, accessibility and screenshot checks.
import type { Page } from '@playwright/test';

export const SCREENS = [
  { name: 'operate', path: '#/operate', heading: 'Operate' },
  { name: 'log', path: '#/log', heading: 'Log' },
  { name: 'activate', path: '#/activate', heading: 'Activate' },
  { name: 'spots', path: '#/spots', heading: 'Spots' },
  { name: 'settings', path: '#/settings', heading: 'Settings' },
  { name: 'radio', path: '#/settings/radio', heading: 'Radio and audio' },
  { name: 'versions', path: '#/settings/versions', heading: 'Version history' },
] as const;

/** 13:14:52 UTC on 13 October 2026, as in the mockups. */
export const FIXED_TIME = Date.UTC(2026, 9, 13, 13, 14, 52);

export async function open(page: Page, path: string, theme: 'light' | 'dark') {
  await page.emulateMedia({ colorScheme: theme });
  await page.clock.setFixedTime(FIXED_TIME);
  await page.goto(`./${path}`);
  await page.locator('main h1').first().waitFor({ state: 'attached' });
  await page.waitForTimeout(300);
}
