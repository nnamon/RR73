/**
 * Reads docs/guide for the Guide in Settings. Only this shape of Markdown is read:
 *
 *   # Title                   the page's title, once, first
 *   ## Heading                a section; text before the first one is a section without a heading
 *   A paragraph, over one or more lines, ended by a blank line.
 *   - An item of a list       one line per item
 *   1. A step                 one line per step
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

export type Block = { kind: 'p'; spans: Span[] } | { kind: 'ul' | 'ol'; items: Span[][] };

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
    if (list) current().blocks.push(list);
    list = null;
  };

  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trim();
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
  return { slug, title, sections };
}

/** The pages index.md lists, in its order, each one present in `files`. */
export function guidePages(files: Record<string, string>): GuidePage[] {
  const index = files.index ? parseGuidePage('index', files.index) : null;
  const slugs: string[] = [];
  for (const s of index?.sections ?? [])
    for (const b of s.blocks)
      if (b.kind !== 'p')
        for (const item of b.items) for (const span of item) if (span.kind === 'page' && files[span.slug] && !slugs.includes(span.slug)) slugs.push(span.slug);
  return slugs.map((slug) => parseGuidePage(slug, files[slug]));
}
