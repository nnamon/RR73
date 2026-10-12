import { describe, expect, it } from 'vitest';
import { compareVersions, longDate, parseChangelog } from './changelog';

const MD = `# Changelog

## Unreleased

- Decodes from the RR73 decoder.

## 0.1.1 · 2026-10-20

- Waterfall keeps its history when the phone rotates.
- Save slot names files by the slot start.
  A continuation line that is not an entry.

## 0.1.0 · 2026-10-13

- Live waterfall from the radio audio input.
- Save any recent slot as a WAV file for the decoder corpus.
* A star bullet, not read.
-No space after the dash, not read.
<script>alert(1)</script>

## 0.0.9 - 2026-10-01

- Under a heading with a hyphen: ignored.

## 0.0.8 · 2026-02-30

- Under an impossible date: ignored.
`;

describe('parseChangelog', () => {
  it('reads releases with their dates and entries, newest first', () => {
    expect(parseChangelog(MD)).toEqual([
      {
        version: '0.1.1',
        date: '2026-10-20',
        entries: ['Waterfall keeps its history when the phone rotates.', 'Save slot names files by the slot start.'],
      },
      {
        version: '0.1.0',
        date: '2026-10-13',
        entries: ['Live waterfall from the radio audio input.', 'Save any recent slot as a WAV file for the decoder corpus.'],
      },
    ]);
  });

  it('includes Unreleased only when asked', () => {
    const withU = parseChangelog(MD, { includeUnreleased: true });
    expect(withU[0]).toEqual({ version: 'Unreleased', date: null, entries: ['Decodes from the RR73 decoder.'] });
    expect(withU).toHaveLength(3);
  });

  it('reads pre-release versions and Windows line ends', () => {
    expect(parseChangelog('## 1.0.0-beta.2 · 2027-01-05\r\n- One.\r\n')).toEqual([{ version: '1.0.0-beta.2', date: '2027-01-05', entries: ['One.'] }]);
  });

  it('gives nothing for an empty file', () => {
    expect(parseChangelog('')).toEqual([]);
  });
});

describe('compareVersions', () => {
  it('orders versions numerically', () => {
    expect(compareVersions('0.1.1', '0.1.0')).toBe(1);
    expect(compareVersions('0.10.0', '0.9.9')).toBe(1);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('0.1.0', '0.2.0')).toBe(-1);
    expect(compareVersions('1.0.0-beta', '1.0.0')).toBe(-1);
  });
});

describe('longDate', () => {
  it('writes dates in British order', () => {
    expect(longDate('2026-10-13')).toBe('13 October 2026');
  });
});
