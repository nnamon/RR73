// The theme for a test. Light is the app's default; Dark and Sun are the operator's choice in
// Settings, which the e2e build reads from window.__rr73Theme before it starts (src/main.ts). The
// system colour scheme follows, for the parts of the page that read it: Sun is a light theme.
import type { Page } from '@playwright/test';

export type TestTheme = 'light' | 'dark' | 'sun';

export async function useTheme(page: Page, theme: TestTheme) {
  await page.emulateMedia({ colorScheme: theme === 'dark' ? 'dark' : 'light' });
  await page.addInitScript((t) => {
    (window as unknown as { __rr73Theme?: string }).__rr73Theme = t;
  }, theme);
}
