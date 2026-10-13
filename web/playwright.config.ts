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
// A 15 s FT8 loop with 4 known messages, 4 copies each (e2e/fixtures/ft8-loop.json).
const ft8Mic = micPlaying('./e2e/fixtures/ft8-loop.wav');
// The same loop with 1 s of silence, written by e2e/global-setup.ts.
const holeMic = micPlaying('./e2e/.fixtures/ft8-loop-hole.wav');
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

/** Projects that finish before the transmit timing tests start. */
const QUIET = ['mic', 'decode', 'slot-record', 'chromium', 'webkit-375x667', 'webkit-393x852'];

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
        // VITE_E2E adds the hooks the tests use (src/lib/testing/e2e-hooks.ts).
        command: 'VITE_E2E=1 npm run build && npx vite preview --host 127.0.0.1 --port 4173 --strictPort',
        cwd: here('.'),
        url: 'http://127.0.0.1:4173',
        timeout: 180_000,
        reuseExistingServer: true,
      },
  projects: [
    { name: 'mic', testMatch: /(audio|start-tone)\.spec/, use: { ...devices['Desktop Chrome'], viewport: { width: 393, height: 852 }, ...fakeMic } },
    // The decode test passes whatever the offset between the loop and the UTC slots. It skips,
    // locally, when the host starves the fake microphone; e2e/decode.spec.ts and docs/testing.md.
    { name: 'decode', testMatch: /decode\.spec/, use: { ...devices['Desktop Chrome'], viewport: { width: 393, height: 852 }, ...ft8Mic } },
    { name: 'slot-record', testMatch: /slot-record\.spec/, use: { ...devices['Desktop Chrome'], viewport: { width: 393, height: 852 }, ...holeMic } },
    { name: 'chromium', testMatch: /(a11y|shell|tune|log|freq|dock)\.spec/, use: { ...devices['Desktop Chrome'], viewport: { width: 393, height: 852 } } },
    { name: 'webkit-375x667', testMatch: /layout\.spec/, use: iphone(375, 667, 2) },
    { name: 'webkit-393x852', testMatch: /layout\.spec/, use: iphone(393, 852, 3) },
    // The transmit tests measure start times to 50 ms against UTC and, in the QSO simulation,
    // need the looped fake microphone to start near a slot boundary. On a loaded machine
    // (load average 14 to 20 seen) the fake audio device lags and decodes come late. They run
    // after the other projects, so the rest of the suite does not load the machine meanwhile
    // (locally: --no-deps to run them alone), with 2 retries.
    { name: 'tx-cq', testMatch: /tx-(cq|again)\.spec/, retries: 2, dependencies: QUIET, use: { ...devices['Desktop Chrome'], viewport: { width: 393, height: 852 }, ...fakeMic } },
    // WebKit's mock microphone runs the audio. Playwright's WebKit reports wrong output timestamps.
    { name: 'webkit-tx', testMatch: /tx-again\.spec/, retries: 2, dependencies: QUIET, use: { ...iphone(393, 852, 3), permissions: ['microphone'] } },
    { name: 'transmit', testMatch: /transmit\.spec/, retries: 2, dependencies: QUIET, use: { ...devices['Desktop Chrome'], viewport: { width: 393, height: 852 }, ...qsoMic } },
  ],
});
