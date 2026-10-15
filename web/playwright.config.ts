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
  // WebKit's mock microphone runs the audio.
  permissions: ['microphone'],
  browserName: 'webkit' as const,
  viewport: { width, height },
  deviceScaleFactor: scale,
  isMobile: true,
  hasTouch: true,
  userAgent: IPHONE_UA,
});

const IPAD_UA =
  'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
/** An iPad in WebKit, upright or on its side: a touch screen, regular width. */
const ipad = (width: number, height: number) => ({
  permissions: ['microphone'],
  browserName: 'webkit' as const,
  viewport: { width, height },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  userAgent: IPAD_UA,
});
/** A desktop window with a mouse, regular width. */
const desk = (browserName: 'chromium' | 'webkit') => ({
  ...(browserName === 'chromium' ? devices['Desktop Chrome'] : devices['Desktop Safari']),
  viewport: { width: 1440, height: 900 },
  ...(browserName === 'webkit' ? { permissions: ['microphone'] } : {}),
});
/** Large screens (large.spec.ts): regular width and a phone on its side. */
const LARGE = /large\.spec/;

/**
 * RR73_REVIEW=1 adds the projects CI leaves out: review-375x667 and review-393x852 capture every
 * screen, sheet and Operate state in both themes for the visual review (AGENTS.md), and
 * slot-record checks the lost-audio measure behind decode.spec's skip (docs/testing.md), and
 * walkthrough takes the README's screenshots.
 */
const REVIEW = !!process.env.RR73_REVIEW;
const desktop = { ...devices['Desktop Chrome'], viewport: { width: 393, height: 852 } };

const reviewProjects = REVIEW
  ? [
      { name: 'slot-record', testMatch: /slot-record\.spec/, use: { ...desktop, ...holeMic } },
      // layout.spec also matches colours-layout.spec. Screenshots go to test-results/screens.
      { name: 'review-375x667', testMatch: /(layout|states|operate|hound|wspr|rtty)\.spec/, use: iphone(375, 667, 2) },
      { name: 'review-393x852', testMatch: /(layout|states|operate|hound|wspr|rtty)\.spec/, use: iphone(393, 852, 3) },
      // Large screens in both themes, for the side-by-side review with the approved mockup.
      { name: 'review-820x1180', testMatch: LARGE, use: ipad(820, 1180) },
      { name: 'review-1180x820', testMatch: LARGE, use: ipad(1180, 820) },
      { name: 'review-1440x900', testMatch: LARGE, use: desk('webkit') },
      { name: 'review-1440x900-chromium', testMatch: LARGE, use: { ...desk('chromium'), ...fakeMic } },
      { name: 'review-852x393', testMatch: LARGE, use: iphone(852, 393, 3) },
      // The README's walkthrough: live practice-band screens (walkthrough.spec.ts).
      { name: 'walkthrough', testMatch: /walkthrough\.spec/, use: iphone(393, 852, 3) },
      { name: 'walkthrough-ipad', testMatch: /walkthrough\.spec/, use: ipad(1180, 820) },
      { name: 'walkthrough-desktop', testMatch: /walkthrough\.spec/, use: desk('webkit') },
    ]
  : [];

/** Projects that finish before the transmit projects start. */
const quietProjects = [
  { name: 'mic', testMatch: /(audio|start-tone|timing)\.spec/, use: { ...desktop, ...fakeMic } },
  // The decode test passes whatever the offset between the loop and the UTC slots. It skips,
  // locally, when the host starves the fake microphone; e2e/decode.spec.ts and docs/testing.md.
  { name: 'decode', testMatch: /decode\.spec/, use: { ...desktop, ...ft8Mic } },
  { name: 'chromium', testMatch: /(a11y|shell|tune|log|freq|dock|features|upgrade|service-worker|colours|list|country|spots|pskreporter|heard-you|wsprnet|upload-defaults|output)\.spec/, use: desktop },
  // Updating beside an older copy also runs in WebKit, the engine on the iPhone.
  { name: 'webkit', testMatch: /upgrade\.spec/, use: iphone(393, 852, 3) },
  // Layout in the light theme: geometry is the same in dark, where only colours change
  // (tokens.css). Checks that do not depend on the screen size run at 375 x 667 only, tagged
  // @ci-375; those that do also run at 393 x 852, tagged @ci-393. layout.spec also matches
  // colours-layout.spec.
  { name: 'webkit-375x667', testMatch: /(layout|operate|hound|wspr|rtty)\.spec/, grep: /@ci-375/, use: iphone(375, 667, 2) },
  { name: 'webkit-393x852', testMatch: /(layout|operate|hound|wspr|rtty)\.spec/, grep: /@ci-393/, use: iphone(393, 852, 3) },
  // Large screens, light theme: one geometry test per size class (regular width on an iPad, in
  // both orientations; compact height on a phone on its side) and the keyboard shortcuts.
  { name: 'webkit-1180x820', testMatch: LARGE, grep: /@ci-regular/, use: ipad(1180, 820) },
  { name: 'webkit-852x393', testMatch: LARGE, grep: /@ci-compact-height/, use: iphone(852, 393, 3) },
  { name: 'chromium-1440x900', testMatch: LARGE, grep: /@ci-keys/, use: desk('chromium') },
  ...reviewProjects,
];

/**
 * Projects that need a machine with no other test running. CI runs them on a machine of their own
 * with RR73_E2E_PART=transmit and the rest of the suite with RR73_E2E_PART=quiet; unset, one run
 * holds both, these after the rest.
 */
const PART = process.env.RR73_E2E_PART;
const QUIET = PART === 'transmit' ? [] : quietProjects.map((p) => p.name);
const transmitProjects = [
  // The transmit tests measure start times to 50 ms against UTC and, in the QSO simulation,
  // need the looped fake microphone to start near a slot boundary. On a loaded machine
  // (load average 14 to 20 seen) the fake audio device lags and decodes come late. They run
  // after the other projects, so the rest of the suite does not load the machine meanwhile, with
  // 2 retries. The QSO comes first: it is the longest of the three.
  { name: 'transmit', testMatch: /transmit\.spec/, retries: 2, dependencies: QUIET, use: { ...desktop, ...qsoMic } },
  { name: 'tx-cq', testMatch: /(tx-cq|rtty-tx)\.spec/, retries: 2, dependencies: QUIET, use: { ...desktop, ...fakeMic } },
  // WebKit's mock microphone runs the audio. Playwright's WebKit reports wrong output timestamps.
  { name: 'webkit-tx', testMatch: /tx-again\.spec/, retries: 2, dependencies: QUIET, use: iphone(393, 852, 3) },
  // The practice band and the web SDR: audio made or streamed in the page, decoded in real time,
  // no microphone. They load the machine as the transmit tests do, so they run after them, with
  // 2 retries.
  { name: 'practice', testMatch: /(practice|web-sdr)\.spec/, retries: 2, dependencies: ['transmit', 'tx-cq', 'webkit-tx'], use: desktop },
];

export default defineConfig({
  testDir: here('./e2e'),
  outputDir: here('./test-results/output'),
  timeout: 60_000,
  // On CI, one retry: WebKit on the runner sometimes crashes a page ("Page crashed", 0.10.0's run
  // on main). A test that passes on its retry is reported as flaky. Projects with their own
  // retries keep them.
  retries: process.env.CI ? 1 : 0,
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
  projects: [...(PART === 'transmit' ? [] : quietProjects), ...(PART === 'quiet' ? [] : transmitProjects)],
});
