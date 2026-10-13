#!/usr/bin/env node
// Copy lint for the style guide in AGENTS.md.
//
// Scans prose: Markdown outside code, string literals and markup text in web/src, and commit
// messages. Interface sources also get the length limits and the subject rule from the copy
// rules: a footer of at most 15 words, a subtitle of at most 6, and no sentence in web/src/views
// that opens with "RR73". Errors fail the run; warnings print for a reviewer. A region between
// `lint-copy: off` and `lint-copy: on` markers (in any comment syntax) is skipped, for quoted
// examples of what not to write.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, relative } from 'node:path';

const ERROR_RULES = [
  { id: 'em-dash', re: /—/g, message: 'em dash; use a full stop, comma, colon or brackets' },
  { id: 'exclamation', re: /[A-Za-z)][!](?=\s|$|["'”’])/g, message: 'exclamation mark' },
  { id: 'emoji', re: /\p{Extended_Pictographic}/gu, message: 'emoji' },
  {
    id: 'hype',
    re: /\b(seamless(?:ly)?|robust|powerful|intuitive|effortless(?:ly)?|cutting-edge|comprehensive|delightful|blazing(?:ly)?|world-class|game-chang\w*)\b/gi,
    message: 'hype word; state a measurement or a concrete property',
  },
  {
    id: 'corporate',
    re: /\b(leverag\w*|unlock(?:s|ed|ing)? (?:the|your|new|more|real|its|their) (?:power|potential|value|possibilit\w+|growth|insights?|opportunit\w+)|empower\w*|elevat(?:e|es|ing)|supercharg\w*|harness(?:es|ing)\b|harness the|streamlin\w*|dive into|deep dive)\b/gi,
    message: 'corporate verb; name the specific action',
  },
  {
    id: 'filler',
    re: /\b(simply|easily|obviously|of course|basically|actually|really)\b/gi,
    message: 'filler word; delete it',
  },
  {
    id: 'meta',
    re: /\b(let's|let us|here's|here is how|this (?:section|document|page|screen) (?:describes|explains|shows|covers)|in this (?:section|document|guide)|it's worth|it is worth|worth noting|importantly|in summary|in conclusion|to summari[sz]e)\b/gi,
    message: 'meta narration or throat-clearing; start with the content',
  },
  {
    id: 'contrast',
    re: /\b(not (?:just|only|merely) [^.]{1,40}, (?:but )?(?:it's|it is|also)|isn't (?:just )?about [^.]{1,40}\. it's about)\b/gi,
    message: 'contrast cliché; state the point directly',
  },
  { id: 'hedge', re: /\b(may potentially|could possibly|might possibly)\b/gi, message: 'stacked hedge' },
  {
    id: 'contrast-semicolon',
    re: /\b(?:no longer|(?:is|are) (?:gone|removed))\b[^.;:!?\n]*;/gi,
    message: 'contrast across a semicolon; state the new behaviour in a sentence of its own',
  },
];

/**
 * Errors for text that reaches the screen: interface strings in web/src, and CHANGELOG.md, which
 * the app shows as Version history. Documents may name components and quote measurements as tools
 * print them; the screen may not.
 */
const SCREEN_RULES = [
  {
    id: 'internal-name',
    re: /\b(top bar|bottom bar|BackLink|feature flags?|calling card|dock)\b/gi,
    message: 'internal name on screen; name what the operator sees',
  },
  { id: 'semicolon', re: /(?<!&#?\w+);/g, message: 'semicolon; one idea per sentence, so split it' },
  {
    id: 'number-word',
    re: /\b(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve) [a-z]+s\b/gi,
    message: 'number in words; write digits',
  },
  {
    id: 'minus-sign',
    re: /(?<![\w.\u2212-])-\d+(?:\.\d+)?(?= ?dB| to [\u2212-]?\d+(?:\.\d+)? ?dB)/g,
    message: 'hyphen-minus in a dB value; write \u2212 (U+2212)',
  },
];

/** Errors for interface strings in web/src only; the changelog may record what earlier versions said. */
const SOURCE_RULES = [
  { id: 'reassurance', re: /\bstays on this phone\b/gi, message: 'reassurance nobody asked for; state the effect or drop it' },
  { id: 'planned', re: /\bplanned\b/gi, message: 'unbuilt feature on screen; show only what is built' },
];

/** A footer says only what stops a costly mistake; a subtitle only what the title would get wrong. */
export const FOOTER_MAX_WORDS = 15;
export const SUBTITLE_MAX_WORDS = 6;

/** "RR73" opening a string, a run of markup text, a sentence or a clause after a colon, followed by a verb or a possessive. "RR73 or RRR" names the message. */
const RR73_SUBJECT = /(?:^\s*|[.?!:]\s+)RR73(?=\s+(?!or\b|and\b)[a-z]|[\u2019']s\b)/g;

const WARN_RULES = [
  { id: 'unlock', re: /\bunlock\w*/gi, message: '"unlock"; fine as the iOS audio term, not as marketing' },
  { id: 'x-not-y', re: /, not\b/gi, message: '", not" contrast; check it is factual, not rhetorical' },
  { id: 'rather-than', re: /\brather than\b/gi, message: '"rather than"; check it is needed' },
  { id: 'instead-of', re: /\binstead of\b/gi, message: '"instead of"; check it is needed' },
];

const SKIP_DIRS = new Set(['node_modules', 'target', 'dist', '.git', 'corpus', 'results', 'pkg', 'vendor', 'src-ft8lib']);
const SKIP_PATHS = [/^tools\/ft8lib\/src\//, /^web\/src\/wasm\/pkg\//, /^LICENSE/];

function walk(dir, root, out) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const rel = relative(root, full);
    if (SKIP_PATHS.some((re) => re.test(rel))) continue;
    const st = statSync(full);
    if (st.isDirectory()) walk(full, root, out);
    else out.push(rel);
  }
}

/** Removes regions between lint-copy off/on markers, keeping line count for line numbers. */
export function stripDisabled(text) {
  const lines = text.split('\n');
  let off = false;
  return lines
    .map((line) => {
      if (/lint-copy:\s*off/.test(line)) {
        off = true;
        return '';
      }
      if (/lint-copy:\s*on/.test(line)) {
        off = false;
        return '';
      }
      return off ? '' : line;
    })
    .join('\n');
}

/** Returns Markdown prose with code blocks, inline code and link targets blanked. */
export function markdownProse(text) {
  let inFence = false;
  return stripDisabled(text)
    .split('\n')
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence;
        return '';
      }
      if (inFence) return '';
      return line
        .replace(/`[^`]*`/g, '')
        .replace(/\]\([^)]*\)/g, ']')
        .replace(/<!--.*?-->/g, '')
        .replace(/https?:\/\/\S+/g, '');
    })
    .join('\n');
}

const blank = (s) => s.replace(/[^\n]/g, ' ');

/** Source with comments blanked; for Svelte, styles too. Line breaks stay. */
function sourceCode(src, ext) {
  if (ext !== '.svelte') return stripComments(src);
  return src
    .replace(/<style[\s\S]*?<\/style>/g, blank)
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/(<script[^>]*>)([\s\S]*?)(<\/script>)/g, (_, open, body, close) => open + stripComments(body) + close);
}

/** Svelte markup with the scripts blanked. */
const markupOf = (code) => code.replace(/<script[\s\S]*?<\/script>/g, blank);

/** Returns a function from a string index to its 0-based line. */
function lineOf(str) {
  const starts = [0];
  for (let i = 0; i < str.length; i++) if (str[i] === '\n') starts.push(i + 1);
  return (index) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= index) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
}

/** Index just past the `}` that closes the `{` at `i`, skipping string and template literals. */
export function closeBrace(s, i) {
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (c === "'" || c === '"') {
      for (j++; j < s.length && s[j] !== c && s[j] !== '\n'; j++) if (s[j] === '\\') j++;
    } else if (c === '`') {
      for (j++; j < s.length && s[j] !== '`'; j++) {
        if (s[j] === '\\') j++;
        else if (s[j] === '$' && s[j + 1] === '{') j = closeBrace(s, j + 1) - 1;
      }
    } else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return j + 1;
  }
  return s.length;
}

/**
 * Replaces each Svelte `{…}` in markup with `replace(tag)`, keeping its line breaks so line
 * numbers hold. Block tags ({#if}, {:else}, {/if}, {@const}) and expressions both pass through.
 */
export function maskExpressions(markup, replace) {
  let out = '';
  let i = 0;
  while (i < markup.length) {
    const j = markup.indexOf('{', i);
    if (j < 0) return out + markup.slice(i);
    const end = closeBrace(markup, j);
    const tag = markup.slice(j, end);
    out += markup.slice(i, j) + replace(tag) + tag.replace(/[^\n]/g, '');
    i = end;
  }
  return out;
}

const isBlockTag = (tag) => /^\{[#:/@]/.test(tag);

/**
 * Prose pieces from Svelte or TypeScript source: markup text, with each expression read as one
 * word and each block tag as a break, and string literals that read as prose. Each piece carries
 * its 0-based line.
 */
export function sourcePieces(text, ext) {
  const src = stripDisabled(text);
  const code = sourceCode(src, ext);
  const pieces = [];
  let m;
  if (ext === '.svelte') {
    const markup = maskExpressions(markupOf(code), (tag) => (isBlockTag(tag) ? '<>' : 'N'));
    const at = lineOf(markup);
    const re = />([^<>{}]+)</g;
    while ((m = re.exec(markup))) if (/[A-Za-z]{2}/.test(m[1])) pieces.push({ line: at(m.index + 1), text: m[1] });
  }
  const at = lineOf(code);
  const literal = /(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g;
  while ((m = literal.exec(code))) if (isProse(m[2])) pieces.push({ line: at(m.index), text: m[2] });
  return pieces;
}

/** Returns prose from Svelte or TypeScript source: string literals and markup text, on their original lines. */
export function sourceProse(text, ext) {
  const lines = stripDisabled(text)
    .split('\n')
    .map(() => '');
  for (const p of sourcePieces(text, ext)) lines[p.line] += ' ' + p.text;
  return lines.join('\n');
}

/** Words in a string: runs of characters that hold a letter or a digit. "4 to 5 ALC bars" is 5. */
export function countWords(s) {
  return s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** String and template literals in a JavaScript expression; template interpolations are values and drop out. */
function literalsIn(js) {
  const out = [];
  for (let i = 0; i < js.length; i++) {
    const c = js[i];
    if (c === "'" || c === '"') {
      let s = '';
      for (i++; i < js.length && js[i] !== c && js[i] !== '\n'; i++) s += js[i] === '\\' ? js[++i] : js[i];
      out.push(s);
    } else if (c === '`') {
      let s = '';
      for (i++; i < js.length && js[i] !== '`'; i++) {
        if (js[i] === '\\') s += js[++i];
        else if (js[i] === '$' && js[i + 1] === '{') {
          const end = closeBrace(js, i + 1);
          out.push(...literalsIn(js.slice(i + 2, end - 1)));
          s += ' ';
          i = end - 1;
        } else s += js[i];
      }
      out.push(s);
    }
  }
  return out;
}

/** Words of copy an expression puts on screen: those of its longest literal. A value (a time, a count, a name) adds none. */
function expressionWords(expr) {
  const lits = literalsIn(expr.slice(1, -1));
  return lits.length ? Math.max(...lits.map(countWords)) : 0;
}

/** The markup between an element's start tag, ending at `start`, and its matching end tag. */
function elementBody(s, tag, start) {
  const re = new RegExp(`<(/?)${tag}\\b[^<>]*>`, 'g');
  re.lastIndex = start;
  let depth = 1;
  let m;
  while ((m = re.exec(s))) {
    if (m[1]) {
      if (--depth === 0) return s.slice(start, m.index);
    } else if (!m[0].endsWith('/>')) depth++;
  }
  return s.slice(start);
}

/**
 * Footers (`section-foot`) over 15 words and subtitles (`row-sub` elements, `sub:` strings) over 6.
 * The words of copy count: markup text and the literals in its expressions. Values such as times,
 * levels and names do not. A block tag starts a new branch, and the longest branch is measured.
 * Text computed in the script is a value here: status and error text follow the style guide's
 * rules for those, not the subtitle limit.
 */
export function lengthFindings(text, ext, file = 'x') {
  const src = stripDisabled(text);
  const code = sourceCode(src, ext);
  const findings = [];
  const add = (line, rule, words, max, what, body) =>
    findings.push({ file, line: line + 1, level: 'error', rule, match: body.replace(/\s+/g, ' ').trim().slice(0, 80), message: `${what} of ${words} words; at most ${max}` });
  let m;
  const at = lineOf(code);
  const sub = /\bsub:\s*(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g;
  while ((m = sub.exec(code))) {
    const words = countWords(m[2].replace(/\$\{[^}]*\}/g, ' '));
    if (words > SUBTITLE_MAX_WORDS) add(at(m.index), 'subtitle-length', words, SUBTITLE_MAX_WORDS, 'subtitle', m[2]);
  }
  if (ext !== '.svelte') return findings;
  const exprs = [];
  const markup = maskExpressions(markupOf(code), (tag) => {
    if (isBlockTag(tag)) return '\u0002';
    exprs.push(tag);
    return `\u0001${exprs.length - 1}\u0001`;
  });
  const mat = lineOf(markup);
  const open = /<(\w+)\b[^<>]*?\bclass="([^"]*)"[^<>]*>/g;
  while ((m = open.exec(markup))) {
    const classes = m[2].split(/\s+/);
    const limit = classes.includes('section-foot') ? ['footer-length', FOOTER_MAX_WORDS, 'footer'] : classes.includes('row-sub') ? ['subtitle-length', SUBTITLE_MAX_WORDS, 'subtitle'] : null;
    if (!limit) continue;
    const body = elementBody(markup, m[1], open.lastIndex);
    const words = Math.max(
      ...body.split('\u0002').map((branch) =>
        branch
          .replace(/<[^<>]*>/g, ' ')
          .split(/(\u0001\d+\u0001)/)
          .reduce((n, part) => n + (/^\u0001\d+\u0001$/.test(part) ? expressionWords(exprs[Number(part.slice(1, -1))]) : countWords(part)), 0),
      ),
    );
    if (words > limit[1]) add(mat(m.index), limit[0], words, limit[1], limit[2], body.replace(/\u0001(\d+)\u0001/g, (_, k) => exprs[Number(k)]).replace(/\u0002/g, ' '));
  }
  return findings;
}

/** Sentences that open with "RR73", in screen sources under web/src/views: narration with the app as its subject. */
export function subjectFindings(text, ext, file = 'x') {
  const findings = [];
  for (const p of sourcePieces(text, ext)) {
    RR73_SUBJECT.lastIndex = 0;
    let m;
    while ((m = RR73_SUBJECT.exec(p.text)))
      findings.push({ file, line: p.line + 1, level: 'error', rule: 'rr73-subject', match: p.text.slice(m.index, m.index + 40).trim(), message: 'RR73 as the subject; state the effect or drop it' });
  }
  return findings;
}

/** True for the screens' sources, where the subject rule applies. */
export const isViewFile = (rel) => /^web\/src\/views\/.*\.(svelte|ts)$/.test(rel) && !rel.endsWith('.test.ts');

/**
 * Blanks JavaScript comments, keeping string literals and line breaks. An apostrophe in a comment
 * would otherwise open a string literal that runs to the next one.
 */
export function stripComments(js) {
  return js.replace(/([\'"`])(?:\\.|(?!\1)[^\\])*?\1|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m) =>
    m[0] === '/' ? m.replace(/[^\n]/g, ' ') : m,
  );
}

/**
 * True for sentence-like strings: several words, lowercase letters, and either a capital first
 * letter or sentence punctuation. Class lists, CSS values and identifiers fail the test.
 */
export function isProse(s) {
  const t = s.trim();
  return /\s/.test(t) && /[a-z]/.test(t) && (/^[A-Z]/.test(t) || /[.,:;?](\s|$)/.test(t));
}

/**
 * Blanks text inside double quotation marks, straight or curly, within a line. Quoting a phrase
 * mentions it, as when a commit message names the words a rule catches; it is not a use.
 */
export function stripQuoted(line) {
  return line.replace(/"[^"\n]*"|\u201c[^\u201d\n]*\u201d/g, (m) => ' '.repeat(m.length));
}

/** True for files whose text reaches the screen. */
export function isScreenFile(rel) {
  return rel === 'CHANGELOG.md' || (/^web\/src\/.*\.(svelte|ts)$/.test(rel) && !rel.endsWith('.test.ts'));
}

export function lintText(prose, file, { screen = false, source = false } = {}) {
  const findings = [];
  const lines = prose.split('\n').map(stripQuoted);
  const errors = [...ERROR_RULES, ...(screen ? SCREEN_RULES : []), ...(source ? SOURCE_RULES : [])];
  const sets = [['error', errors], ['warning', WARN_RULES]];
  lines.forEach((line, i) => {
    for (const [level, rules] of sets) {
      for (const rule of rules) {
        rule.re.lastIndex = 0;
        let m;
        while ((m = rule.re.exec(line))) {
          findings.push({ file, line: i + 1, level, rule: rule.id, match: m[0].trim(), message: rule.message });
        }
      }
    }
  });
  return findings;
}

export function lintFile(root, rel) {
  const ext = extname(rel);
  const text = readFileSync(join(root, rel), 'utf8');
  const screen = isScreenFile(rel);
  if (ext === '.md') return lintText(markdownProse(text), rel, { screen });
  if (!screen) return [];
  return [
    ...lintText(sourceProse(text, ext), rel, { screen, source: true }),
    ...lengthFindings(text, ext, rel),
    ...(isViewFile(rel) ? subjectFindings(text, ext, rel) : []),
  ];
}

function main(argv) {
  const root = process.cwd();
  let findings = [];
  if (argv[0] === '--commit-msg') {
    const msg = readFileSync(argv[1], 'utf8')
      .split('\n')
      .filter((l) => !l.startsWith('#'))
      .join('\n');
    findings = lintText(markdownProse(msg), 'commit message');
  } else {
    const files = [];
    walk(root, root, files);
    for (const rel of files) findings.push(...lintFile(root, rel));
  }
  for (const f of findings) {
    console.log(`${f.file}:${f.line}: ${f.level}: ${f.message} [${f.rule}] "${f.match}"`);
  }
  const errors = findings.filter((f) => f.level === 'error').length;
  const warnings = findings.length - errors;
  console.log(`lint-copy: ${errors} errors, ${warnings} warnings`);
  return errors ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main(process.argv.slice(2)));
