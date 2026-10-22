import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { anchorOf, guidePages, parseGuidePage, parseSpans } from './guide';

describe('parseGuidePage', () => {
  const md = `# Making QSOs

Lead paragraph
over 2 lines.

## Calling CQ

1. Tap CQ.
2. Tx6 goes out: \`CQ 9V1NE OJ11\`.

- An item with a [link](operate.md#the-waterfall).
- A web [address](https://example.org/x).
<!-- a comment -->
- A [broken](elsewhere) link.
`;

  it('reads the title, sections, paragraphs and lists', () => {
    const p = parseGuidePage('making-qsos', md);
    expect(p.title).toBe('Making QSOs');
    expect(p.sections.map((s) => s.heading)).toEqual([null, 'Calling CQ']);
    expect(p.sections[0].blocks).toEqual([{ kind: 'p', spans: [{ kind: 'text', text: 'Lead paragraph over 2 lines.' }] }]);
    const [steps, items] = p.sections[1].blocks;
    expect(steps.kind).toBe('ol');
    expect(items.kind).toBe('ul');
    if (items.kind === 'p') throw new Error('list expected');
    expect(items.items).toHaveLength(3);
    expect(p.sections[1].id).toBe('calling-cq');
  });

  it('reads code and links, and leaves other targets as text', () => {
    expect(parseSpans('Tx6: `CQ 9V1NE OJ11`.')).toEqual([
      { kind: 'text', text: 'Tx6: ' },
      { kind: 'code', text: 'CQ 9V1NE OJ11' },
      { kind: 'text', text: '.' },
    ]);
    expect(parseSpans('[Operate](operate.md#the-waterfall)')).toEqual([{ kind: 'page', text: 'Operate', slug: 'operate', anchor: 'the-waterfall' }]);
    expect(parseSpans('[x](https://example.org/)')).toEqual([{ kind: 'web', text: 'x', url: 'https://example.org/' }]);
    expect(parseSpans('[x](javascript:alert(1))')).toEqual([{ kind: 'text', text: 'x' }, { kind: 'text', text: ')' }]);
  });

  it('makes anchors from headings', () => {
    expect(anchorOf('After RR73')).toBe('after-rr73');
    expect(anchorOf('Web SDR and the relay')).toBe('web-sdr-and-the-relay');
  });
});

describe('docs/guide', () => {
  const dir = new URL('../../../../docs/guide/', import.meta.url);
  const files: Record<string, string> = {};
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.md'))) files[name.slice(0, -3)] = readFileSync(new URL(name, dir), 'utf8');
  const pages = guidePages(files);

  it('lists every page in index.md, each with a title', () => {
    const slugs = Object.keys(files).filter((s) => s !== 'index');
    expect(pages.map((p) => p.slug).sort()).toEqual(slugs.sort());
    for (const p of pages) expect(p.title).not.toBe(p.slug);
  });

  it('links only to pages and sections that exist', () => {
    const ids = new Map(pages.map((p) => [p.slug, new Set(p.sections.map((s) => s.id))]));
    const broken: string[] = [];
    for (const p of pages)
      for (const s of p.sections)
        for (const b of s.blocks)
          for (const spans of b.kind === 'p' ? [b.spans] : b.items)
            for (const x of spans) if (x.kind === 'page' && (!ids.has(x.slug) || (x.anchor && !ids.get(x.slug)!.has(x.anchor)))) broken.push(`${p.slug} → ${x.slug}${x.anchor ? `#${x.anchor}` : ''}`);
    expect(broken).toEqual([]);
  });

  it('uses only the Markdown the app reads', () => {
    for (const [slug, md] of Object.entries(files)) {
      const odd = md.split('\n').filter((l) => /^(#{3,}|\* |\s+- |\|)|\*\*/.test(l));
      expect(odd, slug).toEqual([]);
    }
  });
});
