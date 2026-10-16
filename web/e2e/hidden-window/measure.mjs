// Measures how far a hidden page's transmissions start from slot + 0.5 s, in Chromium driven over
// CDP (docs/decisions/0010-hidden-window.md, docs/testing.md). Another tab in front hides RR73.
// The fake microphone plays fixtures/ft8-loop.wav, where a station calls 9V1NE, so a CQ becomes a
// QSO with a reply every 30 s. Scenarios:
//   silent:  CQ after 1 min hidden, Halt after its transmission, CQ again after 10 min hidden
//   audible: CQ at once and transmissions every 30 s for 11 min hidden
//   visible: the same as audible with the page in front, for comparison
// Usage (in the e2e image, with the e2e build served on port 4173; run.sh does both):
//   node measure.mjs --scenario silent --out /work/web/test-results/hidden-silent.json [--scale 0.1]
import { writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from '@playwright/test';
import { Cdp, evaluate, launch } from './cdp.mjs';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : dflt;
};
const SCENARIO = arg('scenario', 'silent');
const PORT = Number(arg('port', '9333'));
const OUT = arg('out', `/work/web/test-results/hidden-${SCENARIO}.json`);
const MIN = Number(arg('scale', '1')); // 1: real minutes; less for a quick check
const SLOT = 15000;
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)} s]`, ...a);

const PROCESSOR = `
class Tap extends AudioWorkletProcessor {
  constructor() { super(); this.rec = null; this.quiet = 0; this.last = 0; }
  process(inputs) {
    const x = (inputs[0] && inputs[0][0]) || new Float32Array(128);
    let loud = -1;
    for (let i = x.length - 1; i >= 0; i--) if (Math.abs(x[i]) > 1e-4) { loud = i; break; }
    if (loud >= 0) {
      if (!this.rec) {
        let k = 0;
        while (Math.abs(x[k]) <= 1e-4) k++;
        this.rec = { start: currentFrame + k, n: 0 };
        this.port.postMessage({ onset: currentFrame + k, rate: sampleRate });
      }
      this.last = currentFrame + loud;
      this.quiet = 0;
    } else if (this.rec) {
      if (++this.quiet * 128 > sampleRate * 0.5) {
        this.port.postMessage({ start: this.rec.start, end: this.last, rate: sampleRate });
        this.rec = null;
        this.quiet = 0;
      }
    }
    return true;
  }
}
registerProcessor('rr73-test-tap', Tap);`;

function tapInit(source) {
  window.__tx = [];
  const taps = new WeakMap();
  const Orig = window.AudioContext;
  window.AudioContext = class extends Orig {
    constructor(o) {
      super(o);
      const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      taps.set(
        this,
        this.audioWorklet.addModule(url).then(() => {
          const node = new AudioWorkletNode(this, 'rr73-test-tap', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 1, channelCountMode: 'explicit' });
          let onsetUtc = 0;
          node.port.onmessage = (e) => {
            const ts = this.getOutputTimestamp();
            const base = Date.now() - performance.now() + (ts.performanceTime ?? 0) - (ts.contextTime ?? 0) * 1000;
            if (e.data.onset !== undefined) {
              onsetUtc = base + (e.data.onset / e.data.rate) * 1000;
              return;
            }
            const { start, end, rate } = e.data;
            window.__tx.push({ startUtc: onsetUtc, endUtc: base + (end / rate) * 1000, frames: end - start + 1, rate, hidden: document.visibilityState });
          };
          return node;
        }),
      );
    }
  };
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (dest, ...rest) {
    const r = connect.call(this, dest, ...rest);
    const tap = taps.get(this.context);
    if (dest instanceof AudioDestinationNode && tap) void tap.then((node) => connect.call(this, node));
    return r;
  };
  // A chained 250 ms page timer: how late the page's own timers run, ms. Throttled to whole
  // seconds, each runs about 750 ms late.
  window.__pageLate = [];
  let due = performance.now() + 250;
  const tick = () => {
    window.__pageLate.push([Date.now(), Math.round(performance.now() - due)]);
    due = performance.now() + 250;
    setTimeout(tick, 250);
  };
  setTimeout(tick, 250);
}

const { proc, wsUrl } = await launch({
  chrome: chromium.executablePath(),
  port: PORT,
  args: ['--headless=new', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-audio-capture=/work/web/e2e/fixtures/ft8-loop.wav', '--autoplay-policy=no-user-gesture-required', `--user-data-dir=/tmp/rr73-hidden-${PORT}-${Date.now()}`],
});
const cdp = await Cdp.connect(wsUrl);
const { targetInfos } = await cdp.send('Target.getTargets');
const app = targetInfos.find((t) => t.type === 'page');
const { sessionId: sid } = await cdp.send('Target.attachToTarget', { targetId: app.targetId, flatten: true });
await cdp.send('Page.enable', {}, sid);
await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(${tapInit.toString()})(${JSON.stringify(PROCESSOR)})` }, sid);
const ev = (expr) => evaluate(cdp, sid, expr);
const waitFor = async (expr, ms = 20000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await ev(expr).catch(() => false)) return true;
    await sleep(250);
  }
  throw new Error(`timed out: ${expr}`);
};
await cdp.send('Page.navigate', { url: 'http://127.0.0.1:4173/' }, sid);
await waitFor('!!window.__rr73');
await ev(`window.__rr73.settings({ callsign: '9V1NE', grid: 'OJ11', watchdog: false, startTone: false })`);
const click = (label) => ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(label)} && !x.disabled); if (!b) return false; b.click(); return true; })()`);
await click('Start audio');
await waitFor(`window.__rr73.station().audio === 'running'`);
log('audio running');

let other = null;
const hide = async () => {
  ({ targetId: other } = await cdp.send('Target.createTarget', { url: 'about:blank' }));
  await waitFor(`document.visibilityState === 'hidden'`);
};
const show = async () => {
  if (other) await cdp.send('Target.closeTarget', { targetId: other });
  other = null;
};
/** Waits until the slot is 5 to 12 s old, so a CQ tapped now goes out in the next even slot on time. */
const phase = async () => {
  for (;;) {
    const p = Date.now() % SLOT;
    if (p >= 5000 && p <= 12000) return;
    await sleep(200);
  }
};
const cq = async () => {
  await phase();
  const ok = await click('CQ');
  log('CQ tapped', ok);
};
const txOff = async () => {
  const ok = await click('Halt');
  log('Halt tapped', ok);
};

const marks = [];
let hiddenAt = 0;
const until = async (minutes) => {
  const at = hiddenAt + minutes * 60_000 * MIN;
  while (Date.now() < at) await sleep(500);
};
const clockErr = [];
const intended = new Set();
const sampler = setInterval(async () => {
  const v = await ev('window.__rr73.clockErrorMs()').catch(() => null);
  clockErr.push([Math.round((Date.now() - hiddenAt) / 1000), v === null ? null : Math.round(v * 10) / 10]);
}, 5000);
// The start each transmission's report gives, UTC ms by the clock mapping: where the scheduler put it.
const onAirSampler = setInterval(async () => {
  const v = await ev('window.__rr73.station().onAirStartMs').catch(() => null);
  if (v !== null) intended.add(v);
}, 1000);
if (SCENARIO !== 'visible') await hide();
hiddenAt = Date.now();
log(SCENARIO === 'visible' ? 'visible' : 'hidden');
if (SCENARIO === 'silent') {
  await until(1);
  marks.push({ what: 'CQ after 1 min hidden, silent', at: Date.now() });
  await cq();
  await waitFor(`window.__tx.length >= 1`, 60_000);
  await txOff();
  await until(10);
  marks.push({ what: 'CQ after 10 min hidden, silent', at: Date.now() });
  await cq();
  await waitFor(`window.__tx.length >= 4`, 120_000);
  await txOff();
} else {
  marks.push({ what: 'CQ at once, then Tx audio every 30 s', at: Date.now() });
  await cq();
  await until(11);
  await txOff();
}
clearInterval(sampler);
clearInterval(onAirSampler);
const visibility = await ev('document.visibilityState');
const result = await ev(`({ tx: window.__tx, pageLate: window.__pageLate, station: window.__rr73.station(), sent: window.__rr73.transmitted() })`);
await show();
const err = (t) => t.startUtc - (Math.round((t.startUtc - 500) / SLOT) * SLOT + 500);
const rows = result.tx.map((t) => ({ atS: Math.round((t.startUtc - hiddenAt) / 1000), hidden: t.hidden, startErrorMs: Math.round(err(t) * 10) / 10, lengthMs: Math.round((t.frames / t.rate) * 1000) }));
const late = result.pageLate.filter(([at]) => at > hiddenAt).map(([, l]) => l);
// Per 30 s after hiding: the share of 250 ms page timers more than 100 ms late, and the worst.
const windows = [];
for (let w = 0; w * 30_000 < Date.now() - hiddenAt; w++) {
  const xs = result.pageLate.filter(([at]) => at > hiddenAt + w * 30_000 && at <= hiddenAt + (w + 1) * 30_000).map(([, l]) => l);
  if (xs.length) windows.push([w * 30, xs.length, xs.filter((l) => l > 100).length, Math.max(...xs)]);
}
const slots = result.station.slots.filter((s) => s.startUtcMs > hiddenAt && !s.early);
const summary = {
  scenario: SCENARIO,
  visibilityAtEnd: visibility,
  audioAtEnd: result.station.audio,
  marks: marks.map((m) => ({ ...m, atS: Math.round((m.at - hiddenAt) / 1000) })),
  transmissions: rows,
  pageTimerLateMs: { n: late.length, max: Math.max(...late), p50: [...late].sort((a, b) => a - b)[late.length >> 1] },
  pageTimer30s: windows,
  slotsDecodedHidden: slots.length,
  decodesHidden: slots.reduce((a, s) => a + s.decodes, 0),
  skippedHidden: slots.filter((s) => s.skipped).length,
  decodeMs: slots.filter((s) => !s.skipped).map((s) => Math.round(s.ms)),
  sent: result.sent,
  clockErrorMs: clockErr,
  // The scheduler's own start for each transmission against slot + 0.5 s, ms.
  intendedErrorMs: [...intended].map((ms) => [Math.round((ms - hiddenAt) / 1000), Math.round((ms - (Math.round((ms - 500) / SLOT) * SLOT + 500)) * 10) / 10]),
};
writeFileSync(OUT, JSON.stringify(summary, null, 1));
log(JSON.stringify({ ...summary, decodeMs: undefined, sent: undefined }, null, 1));
proc.kill();
process.exit(0);
