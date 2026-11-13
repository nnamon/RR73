// Smoke tests against the built desktop app (docs/testing.md, Desktop app): tauri-driver starts
// the app in WebKitWebDriver, and the tests drive its window. Local stubs stand in for GitHub's
// release feed and the NTP server, and a socat pseudo-terminal pair stands in for the radio.
// Run them in the desktop-e2e service, which has no network: desktop/e2e/run.sh.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Session } from './webdriver.mjs';
import { ntpServer, releaseFeed } from './stubs.mjs';

const APP = process.env.RR73_APP ?? '/work/target/desktop/release/rr73';
const DRIVER = 'http://127.0.0.1:4444';
/** The stub release: newer than any version the app will reach. */
const LATEST = '99.0.0';
/** How far the stub NTP server's clock runs ahead, ms. */
const AHEAD_MS = 5000;
/** The serial port the system lists that the test points at the radio's pseudo-terminal. */
const PORT = '/dev/ttyS0';

/** RR73_E2E_SHOTS names a directory for screenshots of the notice and Settings › About, for the visual review. */
const SHOTS = process.env.RR73_E2E_SHOTS;

async function shot(name) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  writeFileSync(join(SHOTS, `${name}.png`), await app.screenshot());
}

const children = [];
let app;
let feed;
let ntp;
let socatLog;

function run(cmd, args, opts) {
  const child = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'inherit'], ...opts });
  children.push(child);
  return child;
}

async function waitUntil(what, fn, timeoutMs = 10_000) {
  const end = Date.now() + timeoutMs;
  while (!(await fn().catch(() => false))) {
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

before(async () => {
  feed = await releaseFeed(LATEST);
  ntp = await ntpServer(AHEAD_MS);

  // The radio: one end of a pseudo-terminal pair behind the port name the system lists. -x logs
  // the bytes that pass, so the test sees what the app wrote.
  const dir = mkdtempSync(join(tmpdir(), 'rr73-e2e-'));
  socatLog = join(dir, 'socat.log');
  run('sh', ['-c', `exec socat -x -d -d pty,raw,echo=0,link=${PORT} pty,raw,echo=0,link=${dir}/radio 2> ${socatLog}`]);
  await waitUntil('the pseudo-terminal pair', async () => existsSync(PORT));

  // A fresh home: no stored settings, log or notice history from an earlier run.
  const home = join(dir, 'home');
  const env = {
    ...process.env,
    HOME: home,
    XDG_DATA_HOME: join(home, 'data'),
    XDG_CONFIG_HOME: join(home, 'config'),
    XDG_CACHE_HOME: join(home, 'cache'),
    RR73_RELEASE_FEED: feed.url,
  };
  run('tauri-driver', [], { env });
  await waitUntil('tauri-driver', async () => (await fetch(`${DRIVER}/status`)).ok);
  app = await Session.start(DRIVER, APP);
});

after(async () => {
  await app?.quit().catch(() => undefined);
  feed?.close();
  ntp?.close();
  for (const c of children) c.kill();
});

test('starts on Operate', async () => {
  await app.until('the Operate title', async () => (await app.title()) === 'Operate · RR73');
  await app.waitFor('button', 'Start audio');
});

test('shows a newer release from the feed, and Check for new versions turns the check off', async () => {
  const notice = await app.waitFor('[data-testid="release-notice"]', `Version ${LATEST} is available`);
  assert.ok(notice);
  await shot('release-notice');
  assert.equal(feed.requests[0].url, '/latest');
  assert.match(feed.requests[0].accept, /application\/vnd\.github\+json/);

  await app.go('settings/about');
  const row = await app.waitFor('[data-testid="release-row"]', `Version ${LATEST} is available`);
  assert.ok(row);
  await shot('settings-about');
  const toggle = () => app.findText('label.row', 'Check for new versions').then((l) => app.click(l));
  await toggle();
  await app.until('the release row to go', async () => (await app.find('[data-testid="release-row"]')) === null);
  const asked = feed.requests.length;
  await toggle();
  await app.waitFor('[data-testid="release-row"]', `Version ${LATEST} is available`);
  assert.equal(feed.requests.length, asked + 1);
  // The floating notice shows once for each release.
  assert.equal(await app.find('[data-testid="release-notice"]'), null);
});

test('the time server setting corrects the clock', async () => {
  await app.go('settings/radio');
  const field = await app.waitFor('input[aria-label="Time server"]');
  await app.clear(field);
  await app.type(field, '127.0.0.1\uE007');
  const row = await app.waitFor('[data-testid="timing-ntp"]', 'corrected');
  const text = await app.until('a measurement from the stub server', async () => {
    const t = await app.text(row);
    return /^(4\.9\d\d|5\.0\d\d) s slow, ±\d+ ms, corrected$/.test(t) ? t : null;
  });
  assert.ok(ntp.requests() > 0, text);

  // Operate's UTC clock runs on the corrected time: AHEAD_MS ahead of the system's. It ticks once
  // Operate is on screen again.
  await app.go('operate');
  const aheadS = await app.until('the UTC clock to run 5 s ahead', () =>
    app.exec(`
      const el = document.querySelector('.utc');
      if (!el || !/^\\d\\d:\\d\\d:\\d\\d$/.test(el.textContent.trim())) return null;
      const [h, m, s] = el.textContent.trim().split(':').map(Number);
      const shown = h * 3600 + m * 60 + s;
      const sys = Math.floor(Date.now() / 1000) % 86400;
      const ahead = ((shown - sys + 86400 + 43200) % 86400) - 43200;
      return ahead >= 4 && ahead <= 6 ? ahead : null;
    `),
  );
  assert.ok(aheadS >= 4 && aheadS <= 6, `the clock shows ${aheadS} s ahead of the system time`);
});

test('the native serial bridge lists the ports and opens the chosen one', async () => {
  await app.go('settings/rig');
  await app.click(await app.waitFor('label.row', 'Rig control'));
  await app.click(await app.waitFor('button.row', 'Connect radio'));
  await app.waitFor('[data-testid="port-list"]');
  const names = await app.exec(`return [...document.querySelectorAll('[data-testid="port-list"] .row-title')].map((e) => e.textContent.trim())`);
  assert.ok(names.includes(PORT), `the chooser lists ${names.join(', ')}`);
  await app.click(await app.findText('[data-testid="port-list"] button', PORT));
  // Rig control asks the radio over CI-V: frames start FE FE.
  await waitUntil('CI-V bytes on the radio end', async () => /fe fe/i.test(readFileSync(socatLog, 'utf8')), 15_000);
  await app.click(await app.waitFor('button.row', 'Disconnect radio'));
});
