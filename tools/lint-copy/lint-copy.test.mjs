import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lintText, markdownProse, sourceProse, isProse, isScreenFile, isViewFile, stripComments, stripDisabled, stripQuoted, lengthFindings, subjectFindings, statusFindings, countWords, maskExpressions, programFindings } from './lint-copy.mjs';

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

const lengths = (text, ext = '.svelte') => lengthFindings(text, ext).map((f) => `${f.line}:${f.rule}`);
const subjects = (text, ext = '.svelte') => subjectFindings(text, ext).map((f) => `${f.line}:${f.rule}`);

test('counts words as runs that hold a letter or a digit', () => {
  assert.equal(countWords('Set the level for 4 to 5 ALC bars during Tune, no more.'), 13);
  assert.equal(countWords('wavelog.example · sends automatically'), 3);
  assert.equal(countWords(''), 0);
});

test('masks expressions and block tags, keeping line breaks', () => {
  assert.equal(maskExpressions('<p>a {b ? `x${c}y` : "}"} d</p>', () => 'N'), '<p>a N d</p>');
  assert.equal(maskExpressions('{#if a}\nb{/if}', (t) => (t.startsWith('{#') ? '<>' : '')).split('\n').length, 2);
});

test('flags a footer over 15 words and passes a short one', () => {
  const foot = '<div>\n<p class="section-foot">Decodes addressed to this callsign show in red. Transmitting needs the callsign and the grid. Both stay on this phone.</p>\n</div>';
  assert.deepEqual(lengths(foot), ['2:footer-length']);
  assert.deepEqual(lengths('<p class="section-foot">Needed to transmit.</p>'), []);
  assert.deepEqual(lengths('<p class="section-foot err" role="alert">{gridError}</p>'), []);
  assert.deepEqual(lengths('<p class="section-foot">Set the level for <b>4 to 5 ALC bars</b> during Tune, no more.</p>'), []);
});

test('flags another program named in any string literal, and leaves comments and identifiers', () => {
  const programs = (text, ext = '.ts') => programFindings(text, ext).map((f) => `${f.line}:${f.rule}`);
  assert.deepEqual(programs("export const PRESETS = [\n  { id: 'full', label: 'WSJT-X', off: [] },\n];"), ['2:other-program']);
  assert.deepEqual(programs("// Tx1 repeats, as WSJT-X's Hound does.\nconst wsjtx = parse(text);"), []);
  assert.deepEqual(programs("<script>\n  const p = 'JTDX';\n</script>\n<p>Full</p>", '.svelte'), ['2:other-program']);
});

test('flags a footer that opens with a verb and no subject', () => {
  assert.deepEqual(lengths('<p class="section-foot">Uploads the spots your radio decodes.</p>'), ['1:footer-fragment']);
  assert.deepEqual(lengths('<p class="section-foot">Brings web SDR audio to RR73. Carries no passwords.</p>'), ['1:footer-fragment']);
  assert.deepEqual(lengths('<p class="section-foot">Tunes to the band’s dial.</p>'), ['1:footer-fragment']);
  assert.deepEqual(lengths('<p class="section-foot">Spots appear here after each slot ends.</p>'), []);
  assert.deepEqual(lengths('<p class="section-foot">Stations that report your signal appear here.</p>'), []);
  assert.deepEqual(lengths('<p class="section-foot">Set the level with the radio’s AGC on.</p>'), []);
  assert.deepEqual(lengths('<span class="row-sub">Keys the radio when audio starts</span>'), []);
});

test('flags a subtitle over 6 words, in markup, in expressions and in sub strings', () => {
  assert.deepEqual(lengths('<span class="row-sub">Stations already worked today on this band and mode</span>'), ['1:subtitle-length']);
  assert.deepEqual(lengths('<span class="row-sub">Same day, band and mode</span>'), []);
  assert.deepEqual(lengths("<span class=\"row-sub\">{on ? `Tx stays on ${hz} Hz when you call a station` : 'Tx moves'}</span>"), ['1:subtitle-length']);
  assert.deepEqual(lengths("const a = [\n  { title: 'Activations', sub: 'Start POTA, SOTA, WWFF and IOTA activations, and follow their progress.' },\n];", '.ts'), ['2:subtitle-length']);
  assert.deepEqual(lengths("const a = [{ title: 'LoTW users', sub: 'Marks stations that use LoTW' }];", '.ts'), []);
});

test('subtitle length counts copy, measures the longest branch and leaves values out', () => {
  assert.deepEqual(lengths("<span class=\"row-sub\">Tested {utcHm(t)} UTC · {ok ? 'can read and write' : message}</span>"), []);
  assert.deepEqual(lengths('<span class="row-sub">{time} · {snr} dB · DT {dt} s · {hz} Hz</span>'), []);
  assert.deepEqual(lengths('<span class="row-sub">{#if a}Not checked yet. Start audio.{:else}Passed at {t}.{/if}</span>'), []);
  assert.deepEqual(lengths('<span class="row-sub">{#if a}Not checked yet. Start audio with the chime on.{:else}Passed.{/if}</span>'), ['1:subtitle-length']);
  assert.deepEqual(lengths('<span class="row-title">Send edits to QSOs already sent to any destination</span>'), []);
});

test('flags RR73 opening a sentence in the views, and passes RR73 as a message', () => {
  assert.deepEqual(subjects('<p class="section-foot">RR73 is free software under the MIT licence.</p>'), ['1:rr73-subject']);
  assert.deepEqual(subjects('<p>Every QSO stays. RR73 records which copies arrived.</p>'), ['1:rr73-subject']);
  assert.deepEqual(subjects('<span>Off: RR73 sends nothing to Wavelog.</span>'), ['1:rr73-subject']);
  assert.deepEqual(subjects("<script>\n  const s = 'RR73 can’t see this setting.';\n</script>"), ['2:rr73-subject']);
  assert.deepEqual(subjects("<script>\n  // RR73 never allows unattended operation.\n</script>\n<p>Shows after you transmit</p>"), []);
  assert.deepEqual(subjects("<p>Tx4 sends RR73 or RRR. Shows after RR73 transmits.</p>{#each ['RR73', 'RRR'] as a (a)}<b>{a}</b>{/each}"), []);
  assert.deepEqual(subjects("<script>const s = 'RR73 or 73 to another station';</script><p>JA8HCE VK2AXN RR73</p>"), []);
  assert.equal(isViewFile('web/src/views/Settings.svelte'), true);
  assert.equal(isViewFile('web/src/ui/BandSheet.svelte'), false);
  assert.equal(isViewFile('web/src/views/x.test.ts'), false);
});

test('interface sources flag reassurance and plans, and the changelog may quote them', () => {
  const source = (text) => lintText(text, 'x', { screen: true, source: true }).map((f) => `${f.level}:${f.rule}`);
  assert.deepEqual(source('Create a key in Wavelog. The key stays on this phone.'), ['error:reassurance']);
  assert.deepEqual(source('The relay never receives passwords for other services.'), ['error:reassurance']);
  assert.deepEqual(source('Uploads the spots your radio decodes, as WSJT-X does.'), ['error:other-program']);
  assert.deepEqual(source('Decodes take WSJT-X’s colours, in its order.'), ['error:other-program']);
  assert.deepEqual(screen('Off, Tx turns off once the QSO ends, as WSJT-X does with Disable Tx after sending 73.'), ['error:other-program']);
  assert.deepEqual(lintText('The decoder finds 95 % of the messages WSJT-X decodes.', 'docs/bench.md'), []);
  assert.deepEqual(source('It is planned and not built yet.'), ['error:planned']);
  assert.deepEqual(source('The 7 QSOs stay on this phone.'), []);
  assert.deepEqual(screen('Relay is planned. The key stays on this phone.'), []);
});

test('markup text around an expression is prose too', () => {
  const found = lintText(sourceProse('<p>Peak {peak} dBFS. Simply aim for the green zone.</p>', '.svelte'), 'x').map((f) => f.rule);
  assert.deepEqual(found, ['filler']);
});

test('holds status line notices to 6 words of copy with no full stop', () => {
  const status = (text) => statusFindings(text).map((f) => `${f.line}:${f.rule}`);
  assert.deepEqual(status("txSet: (hz) => `Tx set to ${hz} Hz`,"), []);
  assert.deepEqual(status("noReply: (call) => `No reply from ${call} · not logged`,"), []);
  assert.deepEqual(status("txSet: (hz) => `Tx moved to ${hz} Hz, the quietest ${w} Hz in the last slots.`,"), ['1:status-length', '1:status-stop']);
  assert.deepEqual(status("audio: 'Tx stopped because the audio stopped. The QSO keeps its place.',"), ['1:status-length', '1:status-stop']);
  assert.deepEqual(status("noCall: 'No callsign to call.',"), ['1:status-stop']);
  // Comments and values are not copy.
  assert.deepEqual(status("/** A very long comment that says far more than six words. */\nx: `${a} ${b} ${c}`,"), []);
});
