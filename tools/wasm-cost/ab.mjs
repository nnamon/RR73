// Times several rr73-wasm builds against each other in dedicated workers in headless browsers.
// For every slot and run, each build decodes the slot with each plan in turn, so load on a
// shared host falls on all builds alike. Runs in the e2e container with the web dependencies
// installed, on packages built as for ft8.mjs:
//
//   docker compose run --rm e2e node tools/wasm-cost/ab.mjs --pkg before=target/pkg/a \
//     --pkg after=target/pkg/b --plan "subtract-3-osd2" --runs 3 --out results/ab.json \
//     --list slots.txt chromium webkit
//
// Each `--pkg NAME=DIR` is a wasm-pack web build with `enable_stage_timings`; each `--plan` a
// DecoderSession plan. A slot's time is its fastest run, with the decoder's stage timings.
// `--audio-s` decodes the first that many seconds as a partial slot, as the early pass does.
// `--steps` steps the session as the app's worker steps the later stages and records the
// longest step, each slot's shortest over the runs. `--mode FT4` decodes FT4. The report,
// written with `--out`, holds every slot's best run per build and plan.
import { createServer } from 'node:http';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { extname, join, resolve } from 'node:path';

const require = createRequire(new URL('../../web/package.json', import.meta.url));
const playwright = require('@playwright/test');
const args = process.argv.slice(2);
const opts = { pkgs: [], plans: [], runs: 3, mode: 'FT8', audioS: 0, steps: false, out: null, lists: [], paths: [], browsers: [] };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--pkg') { const [n, d] = args[++i].split('='); opts.pkgs.push({ name: n, dir: resolve(d) }); }
  else if (a === '--plan') opts.plans.push(args[++i]);
  else if (a === '--runs') opts.runs = Number(args[++i]);
  else if (a === '--mode') opts.mode = args[++i];
  else if (a === '--audio-s') opts.audioS = Number(args[++i]);
  else if (a === '--out') opts.out = args[++i];
  else if (a === '--steps') opts.steps = true;
  else if (a === '--list') opts.lists.push(args[++i]);
  else if (a === 'chromium' || a === 'webkit') opts.browsers.push(a);
  else opts.paths.push(a);
}
const wavFiles = (p) => (statSync(p).isDirectory() ? readdirSync(p).sort().flatMap((n) => wavFiles(join(p, n))) : p.endsWith('.wav') ? [p] : []);
const files = [...opts.paths.flatMap(wavFiles), ...opts.lists.flatMap((l) => readFileSync(l, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean))];
function readWav(file) {
  const b = readFileSync(file);
  let i = 12;
  while (i + 8 <= b.length) {
    const id = b.toString('ascii', i, i + 4);
    const size = b.readUInt32LE(i + 4);
    if (id === 'data') {
      const out = new Float32Array(Math.floor(size / 2));
      for (let k = 0; k < out.length; k++) out[k] = b.readInt16LE(i + 8 + 2 * k) / 32768;
      return out;
    }
    i += 8 + size + (size & 1);
  }
  throw new Error(file);
}
const worker = (name) => `
import init, * as wasm from '/pkg/${name}/rr73_wasm.js';
const ready = init({ module_or_path: '/pkg/${name}/rr73_wasm_bg.wasm' }).then(() => wasm.enable_stage_timings());
self.onmessage = async (e) => {
  await ready;
  const { samples, mode, plan, partial, steps } = e.data;
  const t0 = performance.now();
  const session = partial ? wasm.DecoderSession.partial(samples, mode, plan) : new wasm.DecoderSession(samples, mode, plan);
  const stages = [];
  const decodes = [];
  let stepMax = 0;
  let stepMaxLater = 0;
  if (steps) {
    // Stepped as the app's worker steps the later stages; stage 1 counted apart.
    while (!session.done) {
      const t = performance.now();
      const out = JSON.parse(session.step());
      const dt = performance.now() - t;
      stepMax = Math.max(stepMax, dt);
      if (out.stage > 0) stepMaxLater = Math.max(stepMaxLater, dt);
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
  const timings = JSON.parse(session.timings());
  session.free();
  self.postMessage({ total, stages, decodes, timings, stepMax, stepMaxLater });
};`;
const TYPES = { '.js': 'text/javascript', '.wasm': 'application/wasm' };
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  try {
    if (path === '/') res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>ab</title>');
    else if (path.startsWith('/worker/')) res.writeHead(200, { 'content-type': 'text/javascript' }).end(worker(path.slice(8, -3)));
    else if (path.startsWith('/pkg/')) {
      const [, , name, ...rest] = path.split('/');
      const file = join(opts.pkgs.find((p) => p.name === name).dir, rest.join('/'));
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
    } else if (path.startsWith('/slot/')) res.writeHead(200).end(Buffer.from(readWav(files[Number(path.slice(6))]).buffer));
    else res.writeHead(404).end();
  } catch (e) {
    res.writeHead(500).end(String(e));
  }
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const origin = `http://127.0.0.1:${server.address().port}`;
const report = { files, plans: opts.plans, pkgs: opts.pkgs.map((p) => p.name), audioS: opts.audioS, mode: opts.mode, runs: opts.runs, browsers: {} };
console.log(`${files.length} ${opts.mode} slots${opts.audioS ? `, first ${opts.audioS} s` : ''}, ${opts.runs} runs, interleaved: ${report.pkgs.join(', ')}`);
for (const name of opts.browsers) {
  const browser = await playwright[name].launch();
  const page = await browser.newPage();
  await page.goto(`${origin}/`);
  page.on('console', (m) => console.log(`  [${name}] ${m.text()}`));
  const results = await page.evaluate(
    async ({ pkgs, plans, count, runs, mode, audioS, steps }) => {
      const workers = Object.fromEntries(pkgs.map((p) => [p, new Worker(`/worker/${p}.js`, { type: 'module' })]));
      const call = (w, msg) => new Promise((ok, fail) => { w.onerror = (e) => fail(new Error(e.message)); w.onmessage = (e) => ok(e.data); w.postMessage(msg, [msg.samples.buffer]); });
      const out = Object.fromEntries(pkgs.map((p) => [p, plans.map(() => [])]));
      for (let s = 0; s < count; s++) {
        const whole = new Float32Array(await (await fetch('/slot/' + s)).arrayBuffer());
        const samples = audioS > 0 ? whole.slice(0, Math.round(audioS * 12000)) : whole;
        const best = Object.fromEntries(pkgs.map((p) => [p, plans.map(() => null)]));
        for (let r = 0; r < runs; r++) {
          for (const p of pkgs) {
            for (let k = 0; k < plans.length; k++) {
              const x = await call(workers[p], { samples: samples.slice(), mode, plan: plans[k], partial: audioS > 0, steps });
              if (best[p][k]) {
                x.stepMax = Math.min(x.stepMax, best[p][k].stepMax);
                x.stepMaxLater = Math.min(x.stepMaxLater, best[p][k].stepMaxLater);
              }
              if (!best[p][k] || x.total < best[p][k].total) best[p][k] = x;
              else Object.assign(best[p][k], { stepMax: x.stepMax, stepMaxLater: x.stepMaxLater });
            }
          }
        }
        for (const p of pkgs) plans.forEach((_, k) => out[p][k].push(best[p][k]));
        if (s % 50 === 49) console.log(`${s + 1} slots`);
      }
      return out;
    },
    { pkgs: report.pkgs, plans: opts.plans, count: files.length, runs: opts.runs, mode: opts.mode, audioS: opts.audioS, steps: opts.steps },
  );
  report.browsers[name] = { version: browser.version(), results };
  console.log(`${name} ${browser.version()} done`);
  await browser.close();
}
server.close();
if (opts.out) writeFileSync(opts.out, JSON.stringify(report));
