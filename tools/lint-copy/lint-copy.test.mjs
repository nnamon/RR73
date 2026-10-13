import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lintText, markdownProse, sourceProse, isProse, isScreenFile, stripComments, stripDisabled, stripQuoted } from './lint-copy.mjs';

const rules = (text) => lintText(text, 'x').map((f) => `${f.level}:${f.rule}`);
const screen = (text) => lintText(text, 'x', { screen: true }).map((f) => `${f.level}:${f.rule}`);

test('flags em dashes, exclamation marks and emoji', () => {
  assert.deepEqual(rules('Fast — very fast'), ['error:em-dash']);
  assert.deepEqual(rules('Logged!'), ['error:exclamation']);
  assert.deepEqual(rules('Done \u{1F389}'), ['error:emoji']);
});

test('flags hype, corporate verbs, fillers and meta narration', () => {
  assert.deepEqual(rules('A seamless experience'), ['error:hype']);
  assert.deepEqual(rules('We leverage the decoder'), ['error:corporate']);
  assert.deepEqual(rules('Harness the decoder'), ['error:corporate']);
  assert.deepEqual(rules('The test harness links ft8_lib.'), []);
  assert.deepEqual(rules('Unlock the potential of FT8'), ['error:corporate', 'warning:unlock']);
  assert.deepEqual(rules('Resume audio plays silence for the same unlock.'), ['warning:unlock']);
  assert.deepEqual(rules('Simply tap Call'), ['error:filler']);
  assert.deepEqual(rules("Here's how the log works"), ['error:meta']);
  assert.deepEqual(rules("It's not just a decoder, it's a lab"), ['error:contrast']);
});

test('warns on contrast phrasing for review', () => {
  assert.deepEqual(rules('Decodes arrive late, not early'), ['warning:x-not-y']);
  assert.deepEqual(rules('Run the copy rather than the original'), ['warning:rather-than']);
});

test('passes plain engineering prose', () => {
  assert.deepEqual(rules('Decodes arrive 0.4 s after the slot ends.'), []);
  assert.deepEqual(rules('Wavelog refused the API key: it can read but not write.'), []);
  assert.deepEqual(rules('Adjust the level until the KX2 shows 4 to 5 ALC bars.'), []);
});

test('markdown prose skips code and disabled regions', () => {
  const md = ['Plain text.', '```', 'let x = a!;', '```', 'Use `simply()` here.', '<!-- lint-copy: off -->', 'Never write "seamless".', '<!-- lint-copy: on -->', 'End.'].join('\n');
  assert.deepEqual(lintText(markdownProse(md), 'x'), []);
});

test('disabled regions keep line numbers', () => {
  assert.equal(stripDisabled('a\n// lint-copy: off\nb\n// lint-copy: on\nc').split('\n').length, 5);
});

test('source prose picks sentences and ignores class lists', () => {
  assert.equal(isProse('rr-row cq selected'), false);
  assert.equal(isProse('0 0 4px'), false);
  assert.equal(isProse('Audio stopped at 13:15:02'), true);
  const svelte = '<script>const label = "Simply tap here.";</script>\n<p>Fast — very</p>\n<div class="a b c"></div>';
  const found = lintText(sourceProse(svelte, '.svelte'), 'x').map((f) => f.rule).sort();
  assert.deepEqual(found, ['em-dash', 'filler']);
});

test('quoted phrases are mentions and pass', () => {
  assert.deepEqual(rules('The rule now catches "harness the" and "seamless".'), []);
  assert.deepEqual(rules('The rule catches \u201csimply\u201d too.'), []);
  assert.deepEqual(rules('Unquoted, simply fails.'), ['error:filler']);
  assert.equal(stripQuoted('a "b" c').length, 7);
});

test('flags contrast across a semicolon anywhere', () => {
  assert.deepEqual(rules('The tab bar is gone; Log opens over Operate.'), ['error:contrast-semicolon']);
  assert.deepEqual(rules('Updating no longer blanks the app; it opens.'), ['error:contrast-semicolon']);
  assert.deepEqual(rules('Updating no longer blanks the app. It opens; then it updates.'), []);
});

test('screen text flags internal names, semicolons, number words and hyphen-minus dB', () => {
  assert.deepEqual(screen("Spots shows in Operate's top bar."), ['error:internal-name']);
  assert.deepEqual(screen('The dock shows the steps.'), ['error:internal-name']);
  assert.deepEqual(screen('Send it again; if it fails, export it.'), ['error:semicolon']);
  assert.deepEqual(screen('The app has three tabs.'), ['error:number-word']);
  assert.deepEqual(screen('Band noise at -15 dB.'), ['error:minus-sign']);
  assert.deepEqual(screen('Signals from -16 to -6 dB.'), ['error:minus-sign', 'error:minus-sign']);
});

test('screen text passes the formats and entities the style guide asks for', () => {
  assert.deepEqual(screen('Band noise at −15 dB, 1500 Hz, 2026-10-13 13:14 UTC.'), []);
  assert.deepEqual(screen('The app has 3 tabs. Tx moved to 1500 Hz.'), []);
  assert.deepEqual(screen('Add&nbsp;QSO and &#8722;15'), []);
  assert.deepEqual(screen('Twice a day, once in a while.'), []);
});

test('screen rules stay off for documents and commit messages', () => {
  assert.deepEqual(rules("Operate's top bar holds three tabs; SNR50 -18.9 dB."), []);
});

test('screen files are interface sources and the changelog', () => {
  assert.equal(isScreenFile('CHANGELOG.md'), true);
  assert.equal(isScreenFile('web/src/views/Settings.svelte'), true);
  assert.equal(isScreenFile('web/src/lib/log/wavelog.ts'), true);
  assert.equal(isScreenFile('web/src/lib/log/wavelog.test.ts'), false);
  assert.equal(isScreenFile('docs/bench.md'), false);
  assert.equal(isScreenFile('AGENTS.md'), false);
});

test('source prose skips comments, so an apostrophe in one opens no string', () => {
  const ts = "// the sequencer's settings; the log's QSOs\nconst a = 'Send it again; then export it.';\n/* it's; here's */";
  const found = lintText(sourceProse(ts, '.ts'), 'x', { screen: true }).map((f) => `${f.line}:${f.rule}`);
  assert.deepEqual(found, ['2:semicolon']);
  const svelte = "<script>\n  // Rx's list; Tx's list\n</script>\n<!-- don't; won't -->\n<p>Tx moved to 1500 Hz.</p>";
  assert.deepEqual(lintText(sourceProse(svelte, '.svelte'), 'x', { screen: true }), []);
  assert.equal(stripComments("a // b\nc").split('\n').length, 2);
  assert.equal(stripComments("const u = 'https://x'; // c"), "const u = 'https://x';     ");
});
