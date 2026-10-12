import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

// Chromium plays a generated WAV as the microphone (see e2e/global-setup.ts).
const fakeMic = {
  permissions: ['microphone'],
  launchOptions: {
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${fileURLToPath(new URL('./e2e/.fixtures/tones.wav', import.meta.url))}`,
    ],
  },
};

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
    { name: 'mic', testMatch: /audio\.spec/, use: { ...devices['Desktop Chrome'], viewport: { width: 393, height: 852 }, ...fakeMic } },
    { name: 'chromium', testMatch: /(a11y|shell|tune)\.spec/, use: { ...devices['Desktop Chrome'], viewport: { width: 393, height: 852 } } },
    { name: 'webkit-375x667', testMatch: /layout\.spec/, use: iphone(375, 667, 2) },
    { name: 'webkit-393x852', testMatch: /layout\.spec/, use: iphone(393, 852, 3) },
  ],
});
