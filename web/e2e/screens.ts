// The app's screens, for the layout, accessibility and screenshot checks. Screens with a seed show
// a log written into IndexedDB first (e2e/log-data.ts).
import type { Page } from '@playwright/test';
import { mockupLog, seed } from './log-data';
import { FIXED_TIME } from './time';

export { FIXED_TIME };

export type SeedName = 'log' | 'running' | 'station';

export interface Screen {
  name: string;
  path: string;
  heading: string;
  seed?: SeedName;
}

export const SCREENS: readonly Screen[] = [
  { name: 'operate', path: '#/operate', heading: 'Operate' },
  { name: 'log', path: '#/log', heading: 'Log' },
  { name: 'activate', path: '#/activate', heading: 'Activate' },
  { name: 'spots', path: '#/spots', heading: 'Spots' },
  { name: 'settings', path: '#/settings', heading: 'Settings' },
  { name: 'radio', path: '#/settings/radio', heading: 'Radio and audio' },
  { name: 'versions', path: '#/settings/versions', heading: 'Version history' },
  { name: 'logging', path: '#/settings/logging', heading: 'Logging' },
  { name: 'wavelog', path: '#/settings/logging/wavelog', heading: 'Wavelog' },
  { name: 'log-all', path: '#/log', heading: 'Log', seed: 'log' },
  { name: 'log-todo', path: '#/log/todo', heading: 'Log', seed: 'log' },
  { name: 'log-activations', path: '#/log/activations', heading: 'Log', seed: 'log' },
  { name: 'activate-last', path: '#/activate', heading: 'Activate', seed: 'log' },
  { name: 'activate-running', path: '#/activate', heading: 'Activation', seed: 'running' },
  { name: 'logging-set-up', path: '#/settings/logging', heading: 'Logging', seed: 'log' },
  { name: 'wavelog-set-up', path: '#/settings/logging/wavelog', heading: 'Wavelog', seed: 'log' },
];

export async function open(page: Page, path: string, theme: 'light' | 'dark', withSeed?: SeedName) {
  await page.emulateMedia({ colorScheme: theme });
  await page.clock.setFixedTime(FIXED_TIME);
  await page.goto(`./${path}`);
  await page.locator('main h1').first().waitFor({ state: 'attached' });
  if (withSeed) await seed(page, mockupLog({ running: withSeed === 'running', stationRefusal: withSeed === 'station' }));
  await page.waitForTimeout(300);
}

export interface SheetCase {
  name: string;
  path: string;
  seed?: SeedName;
  title: string;
  /** Opens the sheet from the screen at `path`. */
  open(page: Page): Promise<void>;
}

/** The log's sheets, opened as an operator would. */
export const LOG_SHEETS: readonly SheetCase[] = [
  { name: 'add-qso', path: '#/log', title: 'Add QSO', open: (page) => page.getByRole('button', { name: 'Add QSO' }).click() },
  { name: 'edit-qso', path: '#/log', seed: 'log', title: 'Edit QSO', open: (page) => page.getByRole('button', { name: /^VK2ESN/ }).first().click() },
  { name: 'end-activation', path: '#/activate', seed: 'running', title: 'End activation?', open: (page) => page.getByRole('button', { name: 'End activation…' }).click() },
  { name: 'station', path: '#/log', seed: 'station', title: 'Choose a station location', open: (page) => page.getByRole('button', { name: 'Fix the QSO with YB0AZK' }).click() },
  { name: 'remove-wavelog', path: '#/settings/logging/wavelog', seed: 'log', title: 'Remove Wavelog?', open: (page) => page.getByRole('button', { name: 'Remove Wavelog…' }).click() },
];
