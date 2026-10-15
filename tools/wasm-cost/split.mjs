// Measures a band split of FT8 or FT4 decoding over two dedicated workers in headless browsers,
// against one worker decoding the whole band (experiment 0009). Runs in the e2e container with
// the web dependencies installed, on a package built as for ft8.mjs:
//
//   docker compose run --rm e2e node tools/wasm-cost/split.mjs --pkg target/ft8-pkg \
//     --plan "subtract-3-osd2" --split 1600 --overlap 60 --runs 3 --out results/split.json \
//     corpus/public chromium webkit
//
// Slots are WAV files (16-bit mono, 12 kHz) under the given paths, or listed one per line in a
// file given with `--list`.
//
// For every slot the page posts a copy of the audio to each worker of a layout and waits for
// all of them: one worker with the plan as given, then two workers that each run the plan with
// every stage limited to one side of `--split` Hz, widened by `--overlap` Hz past it
// (`spectrogram.freq_min_hz` and `spectrogram.freq_max_hz`). The layouts alternate run by run;
// a slot's time is its fastest run, measured on the page from the post to the last reply, and a
// stage ends when the slowest worker ends it. The split's decodes are the union by text of the
// two workers'. The report gives time per slot, decodes gained and lost against one worker
// (by slot and text), and each worker's WebAssembly memory.
import { createServer } from 'node:http';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { extname, join, resolve } from 'node:path';

const require = createRequire(new URL('../../web/package.json', import.meta.url));
const playwright = require('@playwright/test');

const args = process.argv.slice(2);
const opts = { pkg: 'target/ft8-pkg', plan: 'subtract-3-osd2', runs: 3, mode: 'FT8', split: 1600, overlap: 60, min: 200, max: 3000, out: null, lists: [], paths: [], browsers: [] };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--pkg') opts.pkg = args[++i];
  else if (a === '--plan') opts.plan = args[++i];
  else if (a === '--runs') opts.runs = Number(args[++i]);
  else if (a === '--mode') opts.mode = args[++i];
  else if (a === '--split') opts.split = Number(args[++i]);
  else if (a === '--overlap') opts.overlap = Number(args[++i]);
  else if (a === '--out') opts.out = args[++i];
  else if (a === '--list') opts.lists.push(args[++i]);
  else if (a === 'chromium' || a === 'webkit' || a === 'firefox') opts.browsers.push(a);
  else opts.paths.push(a);
}
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
  throw new Error(`${file}: no data chunk`);
}

/** Every stage of `plan` with `extra` overrides appended. */
const limit = (plan, extra) =>
  plan
    .split(';')
    .map((s) => `${s.trim()} ${extra}`)
    .join('; ');
const layouts = {
  one: [opts.plan],
  split: [
    limit(opts.plan, `spectrogram.freq_min_hz=${opts.min} spectrogram.freq_max_hz=${opts.split + opts.overlap}`),
    limit(opts.plan, `spectrogram.freq_min_hz=${opts.split - opts.overlap} spectrogram.freq_max_hz=${opts.max}`),
  ],
};

/** A decoder worker: decodes one slot per message with the given plan. */
const WORKER = `
import init, * as wasm from '/pkg/rr73_wasm.js';
const { DecoderSession } = wasm;
let exports = null;
const ready = init({ module_or_path: '/pkg/rr73_wasm_bg.wasm' }).then((e) => { exports = e; });
self.onmessage = async (e) => {
  await ready;
  const { samples, mode, plan } = e.data;
  const t0 = performance.now();
  const session = new DecoderSession(samples, mode, plan);
  const stages = [];
  const decodes = [];
  for (let k = 0; !session.done; k++) {
    const found = session.next_stage();
    if (found === undefined) break;
    for (const d of JSON.parse(found)) decodes.push({ text: d.text, freq_hz: d.freq_hz, dt_s: d.dt_s, snr_db: d.snr_db, stage: k });
    stages[k] = performance.now() - t0;
  }
  const total = performance.now() - t0;
  session.free();
  self.postMessage({ total, stages, decodes, memory: exports.memory.buffer.byteLength });
};
`;

const pkg = resolve(opts.pkg);
const TYPES = { '.js': 'text/javascript', '.wasm': 'application/wasm', '.html': 'text/html' };
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  try {
    if (path === '/') {
      res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>split</title>');
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
const report = { files, mode: opts.mode, plan: opts.plan, layouts, runs: opts.runs, browsers: {} };
console.log(`${files.length} ${opts.mode} slots, ${opts.runs} runs per layout, best run per slot; split at ${opts.split} Hz, overlap ${opts.overlap} Hz`);
for (const name of opts.browsers) {
  const browser = await playwright[name].launch();
  const page = await browser.newPage();
  await page.goto(`${origin}/`);
  page.on('console', (m) => console.log(`  [${name}] ${m.text()}`));
  const out = await page.evaluate(
    async ({ layouts, count, runs, mode }) => {
      const workers = [0, 1].map(() => new Worker('/worker.js', { type: 'module' }));
      const call = (w, msg, transfer) =>
        new Promise((ok, fail) => {
          w.onerror = (e) => fail(new Error(e.message));
          w.onmessage = (e) => ok(e.data);
          w.postMessage(msg, transfer);
        });
      const names = Object.keys(layouts);
      const results = Object.fromEntries(names.map((n) => [n, []]));
      const memory = Object.fromEntries(names.map((n) => [n, layouts[n].map(() => 0)]));
      for (let s = 0; s < count; s++) {
        const samples = new Float32Array(await (await fetch('/slot/' + s)).arrayBuffer());
        const best = Object.fromEntries(names.map((n) => [n, null]));
        for (let r = 0; r < runs; r++) {
          for (const n of names) {
            const plans = layouts[n];
            const t0 = performance.now();
            const replies = await Promise.all(
              plans.map((plan, i) => {
                const copy = samples.slice();
                return call(workers[i], { samples: copy, mode, plan }, [copy.buffer]);
              }),
            );
            const total = performance.now() - t0;
            replies.forEach((x, i) => (memory[n][i] = Math.max(memory[n][i], x.memory)));
            if (!best[n] || total < best[n].total) {
              const stages = [];
              for (const x of replies) x.stages.forEach((t, k) => (stages[k] = Math.max(stages[k] ?? 0, t)));
              best[n] = { total, stages, workers: replies.map((x) => x.total), decodes: replies.map((x) => x.decodes) };
            }
          }
        }
        for (const n of names) results[n].push(best[n]);
        if (s % 50 === 49) console.log(`${s + 1} slots`);
      }
      workers.forEach((w) => w.terminate());
      return { results, memory };
    },
    { layouts, count: files.length, runs: opts.runs, mode: opts.mode },
  );
  report.browsers[name] = { version: browser.version(), ...out };
  console.log(`\n${name} ${browser.version()}`);
  for (const [n, r] of Object.entries(out.results)) {
    const total = r.map((x) => x.total);
    console.log(`  ${n}: total per slot p50 ${pct(total, 0.5).toFixed(0)} ms, p95 ${pct(total, 0.95).toFixed(0)} ms, max ${Math.max(...total).toFixed(0)} ms, mean ${(total.reduce((a, b) => a + b, 0) / total.length).toFixed(0)} ms`);
    const stages = Math.max(...r.map((x) => x.stages.length));
    for (let k = 0; k < stages; k++) {
      const done = r.map((x) => x.stages[k]).filter((v) => v !== undefined);
      console.log(`    stage ${k + 1} ends at: p50 ${pct(done, 0.5).toFixed(0)} ms, p95 ${pct(done, 0.95).toFixed(0)} ms, max ${Math.max(...done).toFixed(0)} ms`);
    }
    console.log(`    WebAssembly memory per worker: ${out.memory[n].map((b) => `${(b / 2 ** 20).toFixed(1)} MiB`).join(', ')}`);
  }
  // Decodes of the split against one worker, by slot and text.
  let gained = 0;
  let lost = 0;
  let both = 0;
  let overlapDupes = 0;
  const examples = [];
  out.results.one.forEach((one, s) => {
    const a = new Set(one.decodes[0].map((d) => d.text));
    const halves = out.results.split[s].decodes.map((list) => new Set(list.map((d) => d.text)));
    const b = new Set(halves.flatMap((h) => [...h]));
    for (const t of halves[0]) if (halves[1].has(t)) overlapDupes++;
    for (const t of b) if (a.has(t)) both++;
    for (const t of b) if (!a.has(t)) { gained++; if (examples.length < 12) examples.push(`+ ${files[s]}: ${t}`); }
    for (const t of a) if (!b.has(t)) { lost++; if (examples.length < 12) examples.push(`- ${files[s]}: ${t}`); }
  });
  console.log(`  split against one worker: ${both} decodes in both, ${gained} gained, ${lost} lost; ${overlapDupes} decoded by both workers`);
  for (const e of examples) console.log(`    ${e}`);
  await browser.close();
}
server.close();
if (opts.out) writeFileSync(opts.out, JSON.stringify(report));
