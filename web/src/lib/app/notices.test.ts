import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseNotices } from './notices';

const root = (p: string) => readFileSync(new URL(`../../../../${p}`, import.meta.url), 'utf8');
const NOTICES = root('THIRD_PARTY_NOTICES.md');
/** A licence file's paragraphs, as the screen shows them: lines joined with spaces. */
const paragraphsOf = (text: string) =>
  text
    .trim()
    .split(/\n\s*\n/)
    .map((p) => p.split('\n').map((l) => l.trim()).join(' '));

describe('parseNotices', () => {
  it('takes each heading with the text block under it, in paragraphs, and leaves the prose out', () => {
    const md = ['# Notices', '', '## One', '', 'Prose about it.', '', '```text', 'Line one', 'continues.', '', 'Second.', '```', '', '## No licence', '', 'Prose only.', '', '## Two', '```text', 'Only.', '```', '```text', 'A second block.', '```'].join('\n');
    expect(parseNotices(md)).toEqual([
      { name: 'One', paragraphs: ['Line one continues.', 'Second.'] },
      { name: 'Two', paragraphs: ['Only.'] },
    ]);
    expect(parseNotices('')).toEqual([]);
  });
});

describe('THIRD_PARTY_NOTICES.md', () => {
  const notices = parseNotices(NOTICES);

  it('holds ft8_lib, Lucide and Inter', () => {
    expect(notices.map((n) => n.name)).toEqual(['ft8_lib', 'Lucide', 'Inter', 'JetBrains Mono', 'Roboto Mono']);
  });

  it('gives ft8_lib’s MIT licence word for word, as kept beside the crate', () => {
    expect(notices[0].paragraphs).toEqual(paragraphsOf(root('crates/rr73-ft8/LICENSE-ft8_lib')));
    expect(notices[0].paragraphs[1]).toBe('Copyright (c) 2018 Kārlis Goba');
  });

  it('gives Lucide’s ISC licence in full', () => {
    expect(notices[1].paragraphs).toEqual([
      'ISC License',
      'Copyright (c) 2026 Lucide Icons and Contributors',
      'Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.',
      'THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.',
    ]);
  });
});
