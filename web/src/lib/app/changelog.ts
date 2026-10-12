/**
 * Reads CHANGELOG.md for the Version history screen. Only this shape is read:
 *
 *   ## 0.1.0 · 2026-10-13      a release: semver, a middle dot, an ISO date
 *   ## Unreleased             changes not yet released (shown in development builds)
 *   - One entry per line.
 *
 * Every other line is ignored, as are entries under a heading of any other form. Entries are
 * plain text: no Markdown or HTML is interpreted.
 */

export interface Release {
  /** "0.1.0", or "Unreleased". */
  version: string;
  /** "2026-10-13", or null for Unreleased. */
  date: string | null;
  entries: string[];
}

const RELEASE = /^## (\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?) · (\d{4}-\d{2}-\d{2})\s*$/;
const UNRELEASED = /^## Unreleased\s*$/;

export function parseChangelog(md: string, opts: { includeUnreleased?: boolean } = {}): Release[] {
  const out: Release[] = [];
  let section: Release | null = null;
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (line.startsWith('## ')) {
      const m = RELEASE.exec(line);
      if (m && isDate(m[2])) section = { version: m[1], date: m[2], entries: [] };
      else if (UNRELEASED.test(line) && opts.includeUnreleased) section = { version: 'Unreleased', date: null, entries: [] };
      else section = null;
      if (section) out.push(section);
      continue;
    }
    if (line.startsWith('# ')) {
      section = null;
      continue;
    }
    const entry = /^- (.+)$/.exec(line);
    if (entry && section) section.entries.push(entry[1].trim());
  }
  return out;
}

function isDate(s: string): boolean {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Compares two semver strings by their numeric core: −1, 0 or 1. Pre-release sorts before release. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [core, pre] = v.split('-', 2);
    return { nums: core.split('.').map((n) => Number(n) || 0), pre: pre ?? null };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
    if (d) return Math.sign(d);
  }
  if (x.pre === y.pre) return 0;
  if (x.pre === null) return 1;
  if (y.pre === null) return -1;
  return x.pre < y.pre ? -1 : 1;
}

/** "13 October 2026" for "2026-10-13". */
export function longDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}
