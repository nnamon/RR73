/**
 * Reads docs/guide for the Guide in Settings. Only this shape of Markdown is read:
 *
 *   # Title                   the page's title, once, first
 *   ## Heading                a section; text before the first one is a section without a heading
 *   A paragraph, over one or more lines, ended by a blank line.
 *   - An item of a list       one line per item
 *   1. A step                 one line per step
 *   ![Alt](img/name.webp)     an image from docs/guide/img, bundled with the app; a numbered
 *                             list straight after it is its legend, one line per callout
 *   | A | B |                 a table: a header row, a |---| row, then one row per line
 *   ```ladder                 a QSO as messages between You and Them, one line per slot:
 *   You: CQ 9V1NE OJ11        the sender, the message as transmitted and, after " | ", a note;
 *   Them: | No reply          a line with no message is a slot with nothing heard
 *   ```
 *
 * Inside text, `code` is shown as transmitted and [text](target) is a link. A target of another
 * page, `making-qsos.md` or `making-qsos.md#calling-cq`, opens that page in the app; a web
 * address opens in the browser. index.md lists the pages, in order, as a list of links.
 * Everything is plain text: no HTML is interpreted.
 */

export type Span =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'page'; text: string; slug: string; anchor: string | null }
  | { kind: 'web'; text: string; url: string };

/** One slot of a ladder: who sends, the message (empty when nothing is heard) and a note. */
export interface Rung {
  side: 'you' | 'them';
  text: string;
  note: Span[];
}

export type Block =
  | { kind: 'p'; spans: Span[] }
  | { kind: 'ul' | 'ol'; items: Span[][] }
  | { kind: 'figure'; src: string; alt: string; legend: Span[][] }
  | { kind: 'table'; head: Span[][]; rows: Span[][][] }
  | { kind: 'ladder'; rungs: Rung[] };

export interface Section {
  /** Null for the text above the first heading. */
  heading: string | null;
  /** The heading as a link target, "calling-cq" for "Calling CQ". */
  id: string | null;
  blocks: Block[];
}

export interface GuidePage {
  slug: string;
  title: string;
  sections: Section[];
}

/** "Calling CQ" gives "calling-cq": lower case, letters and digits, runs of the rest one hyphen. */
export function anchorOf(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

const IMAGE = /^!\[([^\]]*)\]\((img\/[a-z0-9-]+\.webp)\)$/;
const RUNG = /^(You|Them):(.*)$/;

/** The cells of a table line, `| a | b |`. */
const cells = (line: string) =>
  line
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim());

const PAGE_LINK = /^([a-z0-9-]+)\.md(?:#([a-z0-9-]+))?$/;

/** Text with `code` and [links](target) as spans. */
export function parseSpans(text: string): Span[] {
  const out: Span[] = [];
  const re = /`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let at = 0;
  let m: RegExpExecArray | null;
  const push = (t: string) => {
    if (t) out.push({ kind: 'text', text: t });
  };
  while ((m = re.exec(text))) {
    push(text.slice(at, m.index));
    at = m.index + m[0].length;
    if (m[1] !== undefined) {
      out.push({ kind: 'code', text: m[1] });
      continue;
    }
    const [, , label, target] = m;
    const page = PAGE_LINK.exec(target);
    if (page) out.push({ kind: 'page', text: label, slug: page[1], anchor: page[2] ?? null });
    else if (/^https:\/\//.test(target)) out.push({ kind: 'web', text: label, url: target });
    else push(label);
  }
  push(text.slice(at));
  return out;
}

export function parseGuidePage(slug: string, md: string): GuidePage {
  let title = slug;
  const sections: Section[] = [];
  let section: Section | null = null;
  let para: string[] = [];
  let list: { kind: 'ul' | 'ol'; items: Span[][] } | null = null;
  let table: string[][] | null = null;
  /** Inside a fenced block: the ladder's rungs, or null inside a fence of another kind. */
  let fence: { rungs: Rung[] | null } | null = null;

  const current = (): Section => {
    if (!section) {
      section = { heading: null, id: null, blocks: [] };
      sections.push(section);
    }
    return section;
  };
  const endPara = () => {
    if (para.length) current().blocks.push({ kind: 'p', spans: parseSpans(para.join(' ')) });
    para = [];
  };
  const endList = () => {
    if (!list) return;
    const blocks = current().blocks;
    const last = blocks[blocks.length - 1];
    // A numbered list straight after an image is its legend.
    if (list.kind === 'ol' && last?.kind === 'figure' && !last.legend.length) last.legend = list.items;
    else blocks.push(list);
    list = null;
  };
  const endTable = () => {
    // The second line is the |---| row under the header.
    if (table && table.length >= 2) current().blocks.push({ kind: 'table', head: table[0].map(parseSpans), rows: table.slice(2).map((r) => r.map(parseSpans)) });
    table = null;
  };

  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trim();
    if (fence) {
      if (line === '```') {
        if (fence.rungs) current().blocks.push({ kind: 'ladder', rungs: fence.rungs });
        fence = null;
        continue;
      }
      const rung = RUNG.exec(line);
      if (fence.rungs && rung) {
        const body = rung[2].trim();
        const bar = body.indexOf('|');
        const text = (bar < 0 ? body : body.slice(0, bar)).trim();
        const note = bar < 0 ? '' : body.slice(bar + 1).trim();
        fence.rungs.push({ side: rung[1] === 'You' ? 'you' : 'them', text, note: parseSpans(note) });
      }
      continue;
    }
    if (line.startsWith('```')) {
      endPara();
      endList();
      endTable();
      fence = { rungs: line === '```ladder' ? [] : null };
      continue;
    }
    if (line.startsWith('|')) {
      endPara();
      endList();
      table ??= [];
      table.push(cells(line));
      continue;
    }
    endTable();
    const image = IMAGE.exec(line);
    if (image) {
      endPara();
      endList();
      current().blocks.push({ kind: 'figure', alt: image[1], src: image[2], legend: [] });
      continue;
    }
    const heading = /^(#{1,2}) (.+)$/.exec(line);
    const bullet = /^- (.+)$/.exec(line);
    const step = /^\d+\. (.+)$/.exec(line);
    if (heading) {
      endPara();
      endList();
      if (heading[1] === '#') title = heading[2];
      else {
        section = { heading: heading[2], id: anchorOf(heading[2]), blocks: [] };
        sections.push(section);
      }
    } else if (bullet || step) {
      endPara();
      const kind = bullet ? 'ul' : 'ol';
      if (list && list.kind !== kind) endList();
      list ??= { kind, items: [] };
      list.items.push(parseSpans((bullet ?? step)![1]));
    } else if (!line) {
      endPara();
      endList();
    } else if (!line.startsWith('<!--')) {
      endList();
      para.push(line);
    }
  }
  endPara();
  endList();
  endTable();
  return { slug, title, sections };
}

/** The pages index.md lists, in its order, each one present in `files`. */
export function guidePages(files: Record<string, string>): GuidePage[] {
  const index = files.index ? parseGuidePage('index', files.index) : null;
  const slugs: string[] = [];
  for (const s of index?.sections ?? [])
    for (const b of s.blocks)
      if (b.kind === 'ul' || b.kind === 'ol')
        for (const item of b.items) for (const span of item) if (span.kind === 'page' && files[span.slug] && !slugs.includes(span.slug)) slugs.push(span.slug);
  return slugs.map((slug) => parseGuidePage(slug, files[slug]));
}

/** Every run of text in a block: paragraphs, list items, legend lines, table cells and ladder notes. */
export function blockSpans(b: Block): Span[][] {
  switch (b.kind) {
    case 'p':
      return [b.spans];
    case 'ul':
    case 'ol':
      return b.items;
    case 'figure':
      return b.legend;
    case 'table':
      return [...b.head, ...b.rows.flat()];
    case 'ladder':
      return b.rungs.map((r) => r.note);
  }
}
