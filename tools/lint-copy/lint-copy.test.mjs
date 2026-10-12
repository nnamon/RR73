import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lintText, markdownProse, sourceProse, isProse, stripDisabled } from './lint-copy.mjs';

const rules = (text) => lintText(text, 'x').map((f) => `${f.level}:${f.rule}`);

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
