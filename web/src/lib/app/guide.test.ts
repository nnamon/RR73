import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { anchorOf, blockSpans, guidePages, parseGuidePage, parseSpans } from './guide';

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
    if (items.kind !== 'ul') throw new Error('list expected');
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

  it('reads an image with its legend, and an image with none', () => {
    const p = parseGuidePage('x', `## Controls

![Operate's transmit controls](img/tx-controls.webp)

1. Tx turns transmitting on or off.
2. The [status line](operate.md#status).

![Another](img/other.webp)

Text after it.

1. A list after a paragraph stays a list.
`);
    expect(p.sections[0].blocks).toEqual([
      {
        kind: 'figure',
        src: 'img/tx-controls.webp',
        alt: "Operate's transmit controls",
        legend: [[{ kind: 'text', text: 'Tx turns transmitting on or off.' }], [{ kind: 'text', text: 'The ' }, { kind: 'page', text: 'status line', slug: 'operate', anchor: 'status' }, { kind: 'text', text: '.' }]],
      },
      { kind: 'figure', src: 'img/other.webp', alt: 'Another', legend: [] },
      { kind: 'p', spans: [{ kind: 'text', text: 'Text after it.' }] },
      { kind: 'ol', items: [[{ kind: 'text', text: 'A list after a paragraph stays a list.' }]] },
    ]);
  });

  it('reads only images in img/ as images', () => {
    for (const line of ['![x](https://example.org/a.webp)', '![x](../a.webp)', '![x](img/a.png)']) {
      const [b] = parseGuidePage('x', line).sections[0].blocks;
      expect(b.kind, line).toBe('p');
    }
  });

  it('reads a table', () => {
    const p = parseGuidePage('x', `| Option | Effect |
| --- | --- |
| Repeat CQ | Answers the next caller |
| Answer order | \`First\` or New |
After it.
`);
    expect(p.sections[0].blocks).toEqual([
      {
        kind: 'table',
        head: [[{ kind: 'text', text: 'Option' }], [{ kind: 'text', text: 'Effect' }]],
        rows: [
          [[{ kind: 'text', text: 'Repeat CQ' }], [{ kind: 'text', text: 'Answers the next caller' }]],
          [[{ kind: 'text', text: 'Answer order' }], [{ kind: 'code', text: 'First' }, { kind: 'text', text: ' or New' }]],
        ],
      },
      { kind: 'p', spans: [{ kind: 'text', text: 'After it.' }] },
    ]);
  });

  it('reads a ladder: sender, message, note, and slots with nothing heard', () => {
    const p = parseGuidePage('x', `## Answering a CQ

\`\`\`ladder
Them: CQ K1ABC FN42
You: K1ABC 9V1NE OJ11 | Tx1, double-tap the CQ
Them: | Nothing heard: Tx1 repeats
You: K1ABC 9V1NE OJ11
not a rung
\`\`\`

After.
`);
    expect(p.sections[0].blocks).toEqual([
      {
        kind: 'ladder',
        rungs: [
          { side: 'them', text: 'CQ K1ABC FN42', note: [] },
          { side: 'you', text: 'K1ABC 9V1NE OJ11', note: [{ kind: 'text', text: 'Tx1, double-tap the CQ' }] },
          { side: 'them', text: '', note: [{ kind: 'text', text: 'Nothing heard: Tx1 repeats' }] },
          { side: 'you', text: 'K1ABC 9V1NE OJ11', note: [] },
        ],
      },
      { kind: 'p', spans: [{ kind: 'text', text: 'After.' }] },
    ]);
  });

  it('skips fenced blocks of other kinds, and headings inside fences', () => {
    const p = parseGuidePage('x', '```\n## Not a heading\nYou: CQ\n```\nText.');
    expect(p.sections).toHaveLength(1);
    expect(p.sections[0].blocks).toEqual([{ kind: 'p', spans: [{ kind: 'text', text: 'Text.' }] }]);
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
          for (const spans of blockSpans(b))
            for (const x of spans) if (x.kind === 'page' && (!ids.has(x.slug) || (x.anchor && !ids.get(x.slug)!.has(x.anchor)))) broken.push(`${p.slug} → ${x.slug}${x.anchor ? `#${x.anchor}` : ''}`);
    expect(broken).toEqual([]);
  });

  it('shows only images that exist in docs/guide/img, each under 64 kB, each with alt text', () => {
    const missing: string[] = [];
    const used = new Set<string>();
    for (const p of pages)
      for (const s of p.sections)
        for (const b of s.blocks)
          if (b.kind === 'figure') {
            used.add(b.src);
            const file = new URL(b.src, dir);
            if (!existsSync(file)) missing.push(`${p.slug} → ${b.src}`);
            else expect(statSync(file).size, b.src).toBeLessThan(64_000);
            expect(b.alt, b.src).not.toBe('');
          }
    expect(missing).toEqual([]);
    // Every bundled image is used: the precache holds each one.
    const img = new URL('img/', dir);
    const present = existsSync(img) ? readdirSync(img).map((n) => `img/${n}`) : [];
    expect(present.filter((n) => !used.has(n))).toEqual([]);
  });

  it('writes each ladder line as You or Them, and every fence as a ladder', () => {
    for (const [slug, md] of Object.entries(files)) {
      let inFence = false;
      for (const line of md.split('\n')) {
        if (line.startsWith('```')) {
          if (!inFence) expect(line, slug).toBe('```ladder');
          inFence = !inFence;
        } else if (inFence) expect(line, slug).toMatch(/^(You|Them): ?/);
      }
      expect(inFence, `${slug}: unclosed fence`).toBe(false);
    }
  });

  it('uses only the Markdown the app reads', () => {
    for (const [slug, md] of Object.entries(files)) {
      // Tables are read; a table line is a whole row, | to |.
      const odd = md.split('\n').filter((l) => /^(#{3,}|\* |\s+- )|\*\*|<img|^\|.*[^|]$/.test(l));
      expect(odd, slug).toEqual([]);
    }
  });
});
