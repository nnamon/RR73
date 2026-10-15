/**
 * Reads THIRD_PARTY_NOTICES.md for Settings › About › Credits. Only this shape is read:
 *
 *   ## ft8_lib          a notice: the name of the work
 *   ```text             its licence, word for word, up to the closing fence
 *
 * The prose between them is for the repository and is left out. A heading without a text block
 * gives no notice.
 */

export interface Notice {
  /** "ft8_lib", "Lucide". */
  name: string;
  /** The licence in paragraphs, each with its lines joined by spaces. */
  paragraphs: string[];
}

export function parseNotices(md: string): Notice[] {
  const out: Notice[] = [];
  let name: string | null = null;
  let block: string[] | null = null;
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (block) {
      if (line === '```') {
        if (name) out.push({ name, paragraphs: paragraphs(block) });
        name = null;
        block = null;
      } else block.push(line);
      continue;
    }
    const head = /^## (.+)$/.exec(line);
    if (head) name = head[1].trim();
    else if (line === '```text' && name) block = [];
  }
  return out;
}

function paragraphs(lines: string[]): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  for (const l of [...lines, '']) {
    if (l.trim()) cur.push(l.trim());
    else if (cur.length) {
      out.push(cur.join(' '));
      cur = [];
    }
  }
  return out;
}
