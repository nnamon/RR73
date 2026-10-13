#!/usr/bin/env node
// Copy lint for the style guide in AGENTS.md.
//
// Scans prose: Markdown outside code, string literals and markup text in web/src, and commit
// messages. Errors fail the run; warnings print for a reviewer. A region between
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

/** Returns prose from Svelte or TypeScript source: string literals and markup text, on their original lines. */
export function sourceProse(text, ext) {
  const src = stripDisabled(text);
  const lines = src.split('\n').map(() => '');
  const put = (index, s) => {
    const line = src.slice(0, index).split('\n').length - 1;
    lines[line] += ' ' + s;
  };
  const literal = /(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g;
  let m;
  let code = stripComments(src);
  if (ext === '.svelte') {
    const blank = (s) => s.replace(/[^\n]/g, ' ');
    code = src
      .replace(/<style[\s\S]*?<\/style>/g, blank)
      .replace(/<!--[\s\S]*?-->/g, blank)
      .replace(/(<script[^>]*>)([\s\S]*?)(<\/script>)/g, (_, open, body, close) => open + stripComments(body) + close);
    const markup = code.replace(/<script[\s\S]*?<\/script>/g, (s) => s.replace(/[^\n]/g, ' '));
    const text = />([^<>{}]+)</g;
    while ((m = text.exec(markup))) if (/[A-Za-z]{2}/.test(m[1])) put(m.index + 1, m[1]);
  }
  while ((m = literal.exec(code))) if (isProse(m[2])) put(m.index, m[2]);
  return lines.join('\n');
}

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

export function lintText(prose, file, { screen = false } = {}) {
  const findings = [];
  const lines = prose.split('\n').map(stripQuoted);
  const sets = [['error', screen ? [...ERROR_RULES, ...SCREEN_RULES] : ERROR_RULES], ['warning', WARN_RULES]];
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
  if (screen) return lintText(sourceProse(text, ext), rel, { screen });
  return [];
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
