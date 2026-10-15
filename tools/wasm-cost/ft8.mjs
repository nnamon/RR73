// Measures what decoding an FT8 or FT4 slot costs in rr73-wasm, in a dedicated worker in headless
// browsers, as the app's decoder worker runs it. Runs in the e2e container with the web
// dependencies installed:
//
//   docker compose run --rm rust wasm-pack build crates/rr73-wasm --release --target web \
//     --out-dir ../../target/ft8-pkg
//   docker compose run --rm e2e node tools/wasm-cost/ft8.mjs --pkg target/ft8-pkg \
//     --plan "subtract-3-osd2" --runs 3 --out results/wasm.json corpus/public chromium webkit
//
// Each `--plan` is a DecoderSession plan: stages separated by `;`, each a preset name and
// `key=value` overrides. Every slot is decoded `--runs` times per plan and browser; a slot's
// time is its fastest run. With `--budget-ms`, a run stops stepping once that much time has
// passed since it started, as the app's worker does. `--mode FT4` decodes the slots as FT4
// (default FT8). `--audio-s` decodes only the first that many seconds of each slot as a partial
// slot, as the app's early pass does (13.5 s in FT8, 6 s in FT4). `--stage-timings` times the
// decoder's own stages with performance.now() and prints their mean per slot; the clock reads
// add to the totals, so time totals without it.
// Slots are WAV files (16-bit mono, 12 kHz) under the given paths, or listed
// one per line in a file given with `--list`.
import { createServer } from 'node:http';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { extname, join, resolve } from 'node:path';

const require = createRequire(new URL('../../web/package.json', import.meta.url));
const playwright = require('@playwright/test');

const args = process.argv.slice(2);
const opts = { pkg: 'target/ft8-pkg', plans: [], runs: 3, budgetMs: 0, mode: 'FT8', audioS: 0, stageTimings: false, out: null, lists: [], paths: [], browsers: [] };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--pkg') opts.pkg = args[++i];
  else if (a === '--plan') opts.plans.push(args[++i]);
  else if (a === '--runs') opts.runs = Number(args[++i]);
  else if (a === '--budget-ms') opts.budgetMs = Number(args[++i]);
  else if (a === '--mode') opts.mode = args[++i];
  else if (a === '--audio-s') opts.audioS = Number(args[++i]);
  else if (a === '--stage-timings') opts.stageTimings = true;
  else if (a === '--out') opts.out = args[++i];
  else if (a === '--list') opts.lists.push(args[++i]);
  else if (a === 'chromium' || a === 'webkit' || a === 'firefox') opts.browsers.push(a);
  else opts.paths.push(a);
}
if (opts.plans.length === 0) opts.plans.push('subtract-3-osd2');
if (opts.browsers.length === 0) opts.browsers.push('chromium');

function wavFiles(path) {
  if (statSync(path).isDirectory()) {
    return readdirSync(path)
      .sort()
      .flatMap((name) => wavFiles(join(path, name)));
  }
  return path.endsWith('.wav') ? [path] : [];
}
const files = [
  ...opts.paths.flatMap(wavFiles),
  ...opts.lists.flatMap((l) =>
    readFileSync(l, 'utf8')
      .split('\n')
      .map((s) => s.trim().replace(/^\/work\//, ''))
      .filter(Boolean),
  ),
];
if (files.length === 0) throw new Error('no slots: give WAV files, directories or --list');

/** 16-bit PCM mono at 12 kHz as float samples. */
function readWav(file) {
  const b = readFileSync(file);
  let i = 12;
  let format = null;
  while (i + 8 <= b.length) {
    const id = b.toString('ascii', i, i + 4);
    const size = b.readUInt32LE(i + 4);
    if (id === 'fmt ') format = { channels: b.readUInt16LE(i + 10), rate: b.readUInt32LE(i + 12), bits: b.readUInt16LE(i + 22) };
    if (id === 'data') {
      if (!format || format.channels !== 1 || format.rate !== 12000 || format.bits !== 16) {
        throw new Error(`${file}: expected 16-bit mono at 12 kHz, got ${JSON.stringify(format)}`);
      }
      const out = new Float32Array(Math.floor(size / 2));
      for (let k = 0; k < out.length; k++) out[k] = b.readInt16LE(i + 8 + 2 * k) / 32768;
      return out;
    }
    i += 8 + size + (size & 1);
  }
  throw new Error(`${file}: no data chunk`);
}

/** The worker: decodes each slot with each plan `runs` times and reports the times. */
const WORKER = `
import init, * as wasm from '/pkg/rr73_wasm.js';
const { DecoderSession, version } = wasm;
const ready = init({ module_or_path: '/pkg/rr73_wasm_bg.wasm' });
self.onmessage = (e) => run(e).catch((err) => self.postMessage({ error: String(err && err.stack || err) }));
async function run(e) {
  await ready;
  const { plans, count, runs, budgetMs, mode, audioS, stageTimings } = e.data;
  if (stageTimings) {
    if (!wasm.enable_stage_timings) throw new Error('this build has no enable_stage_timings');
    wasm.enable_stage_timings();
  }
  const results = plans.map(() => []);
  for (let s = 0; s < count; s++) {
    const whole = new Float32Array(await (await fetch('/slot/' + s)).arrayBuffer());
    const samples = audioS > 0 ? whole.slice(0, Math.round(audioS * 12000)) : whole;
    plans.forEach((plan, p) => {
      const best = { total: Infinity, stages: [], decodes: [], stopped: false, stepMax: 0, timings: null };
      for (let r = 0; r < runs; r++) {
        const t0 = performance.now();
        const session = audioS > 0 ? DecoderSession.partial(samples, mode, plan) : new DecoderSession(samples, mode, plan);
        const stages = [];
        const decodes = [];
        let stepMax = 0;
        let stopped = false;
        if (budgetMs > 0) {
          while (!session.done) {
            if (performance.now() - t0 > budgetMs) {
              stopped = true;
              break;
            }
            const t = performance.now();
            const out = JSON.parse(session.step());
            stepMax = Math.max(stepMax, performance.now() - t);
            decodes[out.stage] = (decodes[out.stage] ?? 0) + out.decodes.length;
            if (out.stage_done) stages[out.stage] = performance.now() - t0;
          }
        } else {
          for (let k = 0; !session.done; k++) {
            const found = session.next_stage();
            if (found === undefined) break;
            decodes[k] = JSON.parse(found).length;
            stages[k] = performance.now() - t0;
          }
        }
        const total = performance.now() - t0;
        const timings = stageTimings ? JSON.parse(session.timings()) : null;
        session.free();
        if (total < best.total) Object.assign(best, { total, stages, decodes, stopped, stepMax, timings });
      }
      results[p].push(best);
    });
    if (s % 50 === 49) self.postMessage({ progress: s + 1 });
  }
  self.postMessage({ version: version(), results });
}
`;

const pkg = resolve(opts.pkg);
const TYPES = { '.js': 'text/javascript', '.wasm': 'application/wasm', '.html': 'text/html' };
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  try {
    if (path === '/') {
      res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>cost</title>');
    } else if (path === '/worker.js') {
      res.writeHead(200, { 'content-type': 'text/javascript' }).end(WORKER);
    } else if (path.startsWith('/pkg/')) {
      const file = join(pkg, path.slice('/pkg/'.length));
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
    } else if (path.startsWith('/slot/')) {
      const samples = readWav(files[Number(path.slice('/slot/'.length))]);
      res.writeHead(200, { 'content-type': 'application/octet-stream' }).end(Buffer.from(samples.buffer));
    } else {
      res.writeHead(404).end();
    }
  } catch (e) {
    res.writeHead(500).end(String(e));
  }
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const origin = `http://127.0.0.1:${server.address().port}`;

const pct = (v, q) => {
  const s = [...v].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))];
};
const report = { files, mode: opts.mode, plans: opts.plans, runs: opts.runs, budgetMs: opts.budgetMs, audioS: opts.audioS, browsers: {} };
console.log(`${files.length} ${opts.mode} slots${opts.audioS ? `, first ${opts.audioS} s` : ''}, ${opts.runs} runs each, best run per slot${opts.budgetMs ? `, budget ${opts.budgetMs} ms` : ''}`);
for (const name of opts.browsers) {
  const browser = await playwright[name].launch();
  const page = await browser.newPage();
  await page.goto(`${origin}/`);
  page.on('console', (m) => console.log(`  [${name}] ${m.text()}`));
  const out = await page.evaluate(
    ({ plans, count, runs, budgetMs, mode, audioS, stageTimings }) =>
      new Promise((ok, fail) => {
        const w = new Worker('/worker.js', { type: 'module' });
        w.onerror = (e) => fail(new Error(e.message));
        w.onmessage = (e) => {
          if (e.data.progress) console.log(`${e.data.progress} slots`);
          else if (e.data.error) fail(new Error(e.data.error));
          else ok(e.data);
        };
        w.postMessage({ plans, count, runs, budgetMs, mode, audioS, stageTimings });
      }),
    { plans: opts.plans, count: files.length, runs: opts.runs, budgetMs: opts.budgetMs, mode: opts.mode, audioS: opts.audioS, stageTimings: opts.stageTimings },
  );
  report.browsers[name] = { version: browser.version(), wasm: out.version, results: out.results };
  console.log(`\n${name} ${browser.version()}, rr73-wasm ${out.version}`);
  opts.plans.forEach((plan, p) => {
    const r = out.results[p];
    const total = r.map((x) => x.total);
    const stages = Math.max(...r.map((x) => x.stages.length));
    console.log(`  plan "${plan}"`);
    console.log(`    total per slot: p50 ${pct(total, 0.5).toFixed(0)} ms, p95 ${pct(total, 0.95).toFixed(0)} ms, max ${Math.max(...total).toFixed(0)} ms`);
    for (let k = 0; k < stages; k++) {
      const done = r.map((x) => x.stages[k]).filter((v) => v !== undefined);
      const found = r.reduce((a, x) => a + (x.decodes[k] ?? 0), 0);
      console.log(`    stage ${k + 1} ends at: p50 ${pct(done, 0.5).toFixed(0)} ms, p95 ${pct(done, 0.95).toFixed(0)} ms, max ${Math.max(...done).toFixed(0)} ms; ${found} decodes, ${done.length} of ${r.length} slots finished it`);
    }
    if (opts.budgetMs) {
      const stopped = r.filter((x) => x.stopped).length;
      console.log(`    stopped by the budget: ${stopped} of ${r.length} slots; longest step ${Math.max(...r.map((x) => x.stepMax)).toFixed(1)} ms`);
    }
    if (opts.stageTimings) {
      const keys = ['spectrogram_s', 'search_s', 'refine_s', 'demod_s', 'ldpc_s', 'validate_s', 'subtract_s', 'total_s'];
      const mean = (k) => (1000 * r.reduce((a, x) => a + (x.timings?.stages?.[k] ?? 0), 0)) / r.length;
      console.log(`    decoder stages, mean ms per slot: ${keys.map((k) => `${k.slice(0, -2)} ${mean(k).toFixed(2)}`).join(', ')}`);
    }
  });
  await browser.close();
}
server.close();
if (opts.out) writeFileSync(opts.out, JSON.stringify(report));
