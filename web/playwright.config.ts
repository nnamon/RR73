import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

// Chromium plays a WAV as the microphone, looped from when capture starts.
const micPlaying = (file: string) => ({
  permissions: ['microphone'],
  launchOptions: {
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${fileURLToPath(new URL(file, import.meta.url))}`],
  },
});
// Test tones written by e2e/global-setup.ts.
const fakeMic = micPlaying('./e2e/.fixtures/tones.wav');
// One FT8 slot with 4 known messages (e2e/fixtures/ft8-four-signals.json).
const ft8Mic = micPlaying('./e2e/fixtures/ft8-four-signals.wav');
// The other station of a QSO, written by e2e/global-setup.ts (e2e/qso-script.ts).
const qsoMic = micPlaying('./e2e/.fixtures/qso-script.wav');

// Paths are absolute so the suite runs the same from web/ (npm --prefix web run e2e) and from the
// repository root (npx --prefix web playwright test, through the root playwright.config.ts).
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const iphone = (width: number, height: number, scale: number) => ({
  browserName: 'webkit' as const,
  viewport: { width, height },
  deviceScaleFactor: scale,
  isMobile: true,
  hasTouch: true,
  userAgent: IPHONE_UA,
});

export default defineConfig({
  testDir: here('./e2e'),
  outputDir: here('./test-results/output'),
  timeout: 60_000,
  fullyParallel: true,
  reporter: [['list'], ['json', { outputFile: here('./test-results/report.json') }]],
  globalSetup: here('./e2e/global-setup.ts'),
  use: { baseURL: process.env.BASE_URL ?? 'http://localhost:4173/', serviceWorkers: 'block' },
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: 'npm run build && npx vite preview --host 127.0.0.1 --port 4173 --strictPort',
        cwd: here('.'),
        url: 'http://127.0.0.1:4173',
        timeout: 180_000,
        reuseExistingServer: true,
      },
  projects: [
    { name: 'mic', testMatch: /(audio|start-tone)\.spec/, use: { ...devices['Desktop Chrome'], viewport: { width: 393, height: 852 }, ...fakeMic } },
    // The transmit tests measure start times to 50 ms against UTC and, in the QSO simulation,
    // need the looped fake microphone to start near a slot boundary. On a loaded machine
    // (load average 14 to 17 seen) the fake audio device lags; 2 retries, as for decode.
    { name: 'tx-cq', testMatch: /tx-cq\.spec/, retries: 2, use: { ...devices['Desktop Chrome'], viewport: { width: 393, height: 852 }, ...fakeMic } },
    { name: 'transmit', testMatch: /transmit\.spec/, retries: 2, use: { ...devices['Desktop Chrome'], viewport: { width: 393, height: 852 }, ...qsoMic } },
    // The decode test aligns Chromium's looped fake microphone with UTC slots from the tap; on a heavily
    // loaded host the capture can start late enough to put the signals outside the decoder's DT
    // window. Retries bound that; a decoding regression still fails all three attempts.
    { name: 'decode', retries: 2, testMatch: /decode\.spec/, use: { ...devices['Desktop Chrome'], viewport: { width: 393, height: 852 }, ...ft8Mic } },
    { name: 'chromium', testMatch: /(a11y|shell|tune|freq|dock)\.spec/, use: { ...devices['Desktop Chrome'], viewport: { width: 393, height: 852 } } },
    { name: 'webkit-375x667', testMatch: /layout\.spec/, use: iphone(375, 667, 2) },
    { name: 'webkit-393x852', testMatch: /layout\.spec/, use: iphone(393, 852, 3) },
  ],
});
