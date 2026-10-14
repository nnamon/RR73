// Measures what the RTTY exports of rr73-wasm cost per second of audio in headless browsers:
// the receiver fed 512-sample chunks at 12 kHz (the capture worklet's chunk size) with the
// events parsed, the keyboard transmitter rendering 0.1 s blocks at 48 kHz, and one-shot
// encoding at 48 kHz. Runs in the e2e container with the web dependencies installed:
//
//   docker compose run --rm rust wasm-pack build crates/rr73-wasm --release --target web \
//     --out-dir ../../target/rtty-pkg
//   docker compose run --rm e2e node tools/wasm-cost/rtty.mjs target/rtty-pkg chromium webkit
//
// The audio is 60 s of keying at -5 dB SNR in 3000 Hz with seeded noise, so every run decodes
// the same samples. Each measure is repeated; the report gives the median and the fastest run.
import { readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const require = createRequire(new URL('../../web/package.json', import.meta.url));
const playwright = require('@playwright/test');

const pkg = resolve(process.argv[2] ?? 'target/rtty-pkg');
const browsers = process.argv.length > 3 ? process.argv.slice(3) : ['chromium'];
const ORIGIN = 'http://rr73.test';
const TYPES = { '.js': 'text/javascript', '.wasm': 'application/wasm', '.html': 'text/html' };

/** Runs in the page: loads the module, builds the audio, times each export. */
async function measure({ origin, reps }) {
  const t0 = performance.now();
  const m = await import(`${origin}/pkg/rr73_wasm.js`);
  await m.default({ module_or_path: `${origin}/pkg/rr73_wasm_bg.wasm` });
  const loadMs = performance.now() - t0;

  const line = 'CQ TEST 9V1NE 9V1NE 599 015 TU (73) QUICK BROWN FOX 1234567890\n';
  const text = line.repeat(6);
  const clean = m.rtty_encode(text, JSON.stringify({ sample_rate: 12000 }));
  // Amplitude 1 has power 0.5; noise of variance v has v / 2 in 3000 Hz at 12 kHz.
  const snrDb = -5;
  const sigma = Math.sqrt(10 ** (-snrDb / 10));
  let seed = 12345;
  const uniform = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const lead = 12000;
  const audio = new Float32Array(clean.length + 2 * lead);
  for (let i = 0; i < audio.length; i++) {
    const g = Math.sqrt(-2 * Math.log(1 - uniform())) * Math.cos(2 * Math.PI * uniform());
    const s = i >= lead && i < lead + clean.length ? clean[i - lead] : 0;
    audio[i] = 0.05 * (s + sigma * g);
  }
  const audioS = audio.length / 12000;

  const rx = [];
  let received = '';
  for (let r = 0; r < reps; r++) {
    const dec = new m.RttyReceiver(JSON.stringify({ squelch_db: -14 }));
    let got = '';
    const start = performance.now();
    for (let i = 0; i < audio.length; i += 512) {
      for (const e of JSON.parse(dec.push(audio.subarray(i, i + 512)))) if (e.type === 'char') got += e.ch;
    }
    for (const e of JSON.parse(dec.flush())) if (e.type === 'char') got += e.ch;
    rx.push((performance.now() - start) / audioS);
    dec.free();
    received = got;
  }

  const tx = [];
  let txS = 0;
  for (let r = 0; r < reps; r++) {
    const mod = new m.RttyTransmitter(JSON.stringify({ sample_rate: 48000 }));
    mod.push_text(text);
    mod.finish();
    let samples = 0;
    const start = performance.now();
    while (!mod.is_done) samples += mod.render(4800).length;
    tx.push((performance.now() - start) / (samples / 48000));
    txS = samples / 48000;
    mod.free();
  }

  const enc = [];
  for (let r = 0; r < reps; r++) {
    const start = performance.now();
    const out = m.rtty_encode(text, JSON.stringify({ sample_rate: 48000 }));
    enc.push((performance.now() - start) / (out.length / 48000));
  }
  return { loadMs, audioS, txS, rx, tx, enc, sent: text, received };
}

const stats = (v) => {
  const s = [...v].sort((a, b) => a - b);
  return { median: s[Math.floor(s.length / 2)], best: s[0] };
};
const fmt = (v) => `${stats(v).median.toFixed(3)} ms (fastest ${stats(v).best.toFixed(3)} ms)`;

const wasmBytes = statSync(join(pkg, 'rr73_wasm_bg.wasm')).size;
console.log(`Module: ${(wasmBytes / 1024).toFixed(0)} KiB (${pkg})`);
for (const name of browsers) {
  const type = playwright[name];
  if (!type) throw new Error(`unknown browser ${name}`);
  const browser = await type.launch();
  const page = await browser.newPage();
  await page.route(`${ORIGIN}/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    if (!path.startsWith('/pkg/')) {
      return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>cost</title>' });
    }
    const file = join(pkg, path.slice('/pkg/'.length));
    const ext = file.slice(file.lastIndexOf('.'));
    return route.fulfill({ contentType: TYPES[ext] ?? 'application/octet-stream', body: readFileSync(file) });
  });
  await page.goto(`${ORIGIN}/`);
  const r = await page.evaluate(measure, { origin: ORIGIN, reps: 7 });
  const clean = (t) => t.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const exact = clean(r.received) === r.sent;
  console.log(`\n${name} ${browser.version()}`);
  console.log(`  load and compile: ${r.loadMs.toFixed(0)} ms`);
  console.log(`  receive, per second of audio (${r.audioS.toFixed(1)} s, 512-sample chunks): ${fmt(r.rx)}`);
  console.log(`  copy at -5 dB: ${exact ? 'exact' : `differs: ${JSON.stringify(r.received)}`}`);
  console.log(`  transmit render at 48 kHz, per second (${r.txS.toFixed(1)} s, 4800-sample blocks): ${fmt(r.tx)}`);
  console.log(`  one-shot encode at 48 kHz, per second: ${fmt(r.enc)}`);
  await browser.close();
}
