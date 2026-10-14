// The app's screens, for the layout, accessibility and screenshot checks. Screens with a seed show
// a log written into IndexedDB first (e2e/log-data.ts).
import type { Page } from '@playwright/test';
import type { Features } from '../src/lib/state/settings.svelte';
import { emptySeed, mockupLog, seed, withFeatures } from './log-data';
import { RELAY_SET_UP, routeRelay } from './relay-stand-in';
import { feedSpot, publish, routeFeed } from './feed-stand-in';
import { FIXED_TIME } from './time';

export { FIXED_TIME };

export type SeedName = 'log' | 'running' | 'station';

export interface Screen {
  name: string;
  path: string;
  heading: string;
  seed?: SeedName;
  /** Optional features to turn on first; all are off on a new install. */
  features?: Partial<Features>;
  /** Practice band on (Settings › Practice band), stored before the screen opens. */
  practice?: boolean;
  /** A relay added with Web SDR on (relay-stand-in.ts), stored before the screen opens. */
  relay?: boolean;
  /** PSK Reporter reports on, with an antenna, stored before the screen opens. */
  psk?: boolean;
  /** Heard you on, with the stand-in feed publishing 4 reports (feed-stand-in.ts). */
  heard?: boolean;
}

const ACTIVATIONS = { activations: true };

export const SCREENS: readonly Screen[] = [
  { name: 'operate', path: '#/operate', heading: 'Operate' },
  { name: 'log', path: '#/log', heading: 'Log' },
  { name: 'spots', path: '#/spots', heading: 'Spots', features: ACTIVATIONS },
  { name: 'spots-sources', path: '#/spots', heading: 'Spots', features: { potaSpots: true, clusterSpots: true } },
  { name: 'settings', path: '#/settings', heading: 'Settings' },
  { name: 'settings-features', path: '#/spots', heading: 'Settings' },
  { name: 'radio', path: '#/settings/radio', heading: 'Radio and audio' },
  { name: 'ft8-settings', path: '#/settings/ft8', heading: 'FT8 and FT4' },
  { name: 'wspr-settings', path: '#/settings/wspr', heading: 'WSPR' },
  { name: 'versions', path: '#/settings/versions', heading: 'Version history' },
  { name: 'logging', path: '#/settings/logging', heading: 'Logging' },
  { name: 'colours', path: '#/settings/colours', heading: 'Decode colours' },
  { name: 'wavelog', path: '#/settings/logging/wavelog', heading: 'Wavelog' },
  { name: 'log-all', path: '#/log', heading: 'Log', seed: 'log' },
  { name: 'log-todo', path: '#/log/todo', heading: 'Log', seed: 'log' },
  { name: 'log-activations', path: '#/log/activations', heading: 'Log', seed: 'log', features: ACTIVATIONS },
  { name: 'spots-running', path: '#/spots', heading: 'Spots', seed: 'running', features: ACTIVATIONS },
  { name: 'operate-running', path: '#/operate', heading: 'Operate', seed: 'running', features: ACTIVATIONS },
  { name: 'logging-set-up', path: '#/settings/logging', heading: 'Logging', seed: 'log', features: ACTIVATIONS },
  { name: 'wavelog-set-up', path: '#/settings/logging/wavelog', heading: 'Wavelog', seed: 'log' },
  { name: 'practice', path: '#/settings/practice', heading: 'Practice band' },
  { name: 'practice-on', path: '#/settings/practice', heading: 'Practice band', practice: true },
  { name: 'operate-practice', path: '#/operate', heading: 'Operate', practice: true },
  { name: 'log-practice', path: '#/log', heading: 'Practice log', practice: true },
  { name: 'relay', path: '#/settings/relay', heading: 'Relay' },
  { name: 'relay-set-up', path: '#/settings/relay', heading: 'Relay', relay: true },
  { name: 'web-sdr', path: '#/settings/sdr', heading: 'Web SDR' },
  { name: 'web-sdr-set-up', path: '#/settings/sdr', heading: 'Web SDR', relay: true },
  { name: 'operate-web-sdr', path: '#/operate', heading: 'Operate', relay: true },
  { name: 'psk-reporter', path: '#/settings/pskreporter', heading: 'PSK Reporter' },
  { name: 'psk-reporter-on', path: '#/settings/pskreporter', heading: 'PSK Reporter', relay: true, psk: true },
  { name: 'spots-heard', path: '#/spots', heading: 'Spots', heard: true },
];

/**
 * Opens a screen, after writing the seed and the features into the app's storage. The seed goes
 * in first: a path such as Spots leads elsewhere while its features are off.
 */
export async function open(page: Page, path: string, theme: 'light' | 'dark', withSeed?: SeedName, features?: Partial<Features>, practice = false, relay = false, psk = false, heard = false) {
  await page.emulateMedia({ colorScheme: theme });
  await page.clock.setFixedTime(FIXED_TIME);
  if (relay) await routeRelay(page);
  if (heard) {
    const nowS = Math.floor(FIXED_TIME / 1000);
    await routeFeed(page, (ws, topic) => {
      const tx = topic.split('/')[5];
      for (const [rc, rl, rp, band, ago] of [
        ['JA1XYZ', 'PM95qq', -3, '20m', 20],
        ['VK3QRP', 'QF22lb', null, '20m', 35],
        ['K1ABC', 'FN42hn', -21, '20m', 50],
        ['DL1ABC', 'JO62', -17, '40m', 400],
      ] as const)
        ws.send(publish(`pskr/filter/v2/${band}/FT8/${tx}/${rc}/OJ11/${rl.slice(0, 4)}/381/1`, feedSpot(nowS, tx, rc, rl, rp, band, ago)));
    });
  }
  if (withSeed || features || practice || relay || psk || heard) {
    await page.goto('./');
    const data = withSeed ? mockupLog({ running: withSeed === 'running', stationRefusal: withSeed === 'station' }) : emptySeed();
    const all = features ? withFeatures(data, features) : data;
    const kv = [...all.kv, ...(practice ? [{ key: 'practice', value: { on: true } }] : []), ...(relay ? [{ key: 'relay', value: RELAY_SET_UP }] : []), ...(psk ? [{ key: 'pskreporter', value: { on: true, antenna: 'Vertical, 10 m up' } }] : []), ...(heard ? [{ key: 'heardyou', value: { on: true } }] : []), ...(heard && !all.kv.some((k) => k.key === 'settings') ? [{ key: 'settings', value: { callsign: '9V1NE', grid: 'OJ11' } }] : [])];
    await seed(page, { ...all, kv });
  }
  await page.goto(`./${path}`);
  await page.locator('main h1').first().waitFor({ state: 'attached' });
  await page.waitForTimeout(300);
}

export interface SheetCase {
  name: string;
  path: string;
  seed?: SeedName;
  features?: Partial<Features>;
  title: string;
  /** Opens the sheet from the screen at `path`. */
  open(page: Page): Promise<void>;
}

/** The log's sheets, opened as an operator would. */
export const LOG_SHEETS: readonly SheetCase[] = [
  { name: 'add-qso', path: '#/log', title: 'Add QSO', open: (page) => page.getByRole('button', { name: 'Add QSO' }).click() },
  { name: 'edit-qso', path: '#/log', seed: 'log', title: 'Edit QSO', open: (page) => page.getByRole('button', { name: /^VK2ESN/ }).first().click() },
  { name: 'start-activation', path: '#/spots', features: ACTIVATIONS, title: 'Start activation', open: (page) => page.getByRole('button', { name: /^Start activation/ }).click() },
  { name: 'edit-activation', path: '#/spots', seed: 'running', features: ACTIVATIONS, title: 'Edit activation', open: (page) => page.getByRole('button', { name: 'Edit activation' }).click() },
  { name: 'end-activation', path: '#/spots', seed: 'running', features: ACTIVATIONS, title: 'End activation?', open: (page) => page.getByRole('button', { name: 'End activation…' }).click() },
  { name: 'station', path: '#/log', seed: 'station', title: 'Choose a station location', open: (page) => page.getByRole('button', { name: 'Fix the QSO with YB0AZK' }).click() },
  { name: 'colour', path: '#/settings/colours', title: 'New call', open: (page) => page.getByRole('button', { name: 'Change colour: New call', exact: true }).click() },
  { name: 'remove-wavelog', path: '#/settings/logging/wavelog', seed: 'log', title: 'Remove Wavelog?', open: (page) => page.getByRole('button', { name: 'Remove Wavelog…' }).click() },
];
