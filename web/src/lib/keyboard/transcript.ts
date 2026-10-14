/**
 * The received text pane's content: received and sent characters in the order they happened,
 * newest at the bottom, as on a teleprinter. A sender's line feed starts a new line; carriage
 * returns, BELL and WRU print nothing. A divider with the UTC time opens text that follows 20 s
 * with nothing sent or received, and a change of band adds one with the band and dial. The pane
 * keeps 2000 lines.
 */

import { utcHm } from '../clock/format';

/** r: received; u: received with a framing error or low confidence; t: sent. */
export type CharKind = 'r' | 'u' | 't';

export interface TextLine {
  id: number;
  kind: 'text';
  text: string;
  /** One CharKind per character of `text`. */
  kinds: string;
  /** Time of the first and the last character, UTC ms. */
  firstMs: number;
  lastMs: number;
}

export interface DividerLine {
  id: number;
  kind: 'divider';
  text: string;
}

export type Line = TextLine | DividerLine;

/** Received text since a moment, as runs of consecutive received characters. */
export interface RxRun {
  /** The characters, with uncertain ones as U+FFFD so no word with one matches a pattern. */
  text: string;
  atMs: number;
}

export const KEEP_LINES = 2000;
export const QUIET_MS = 20_000;

export class Transcript {
  private all: Line[] = [];
  private nextId = 1;
  private lastMs: number | null = null;

  /** The lines, oldest first. A new array after every change. */
  get lines(): readonly Line[] {
    return this.all;
  }

  /** True when the last line is empty or a divider: new text starts at the left edge. */
  get atLineStart(): boolean {
    const last = this.all.at(-1);
    return !last || last.kind === 'divider' || last.text.length === 0;
  }

  /** Adds one character. Returns false when it prints nothing. */
  add(ch: string, kind: CharKind, atMs: number): boolean {
    if (ch === '\r' || (ch < ' ' && ch !== '\n')) return false;
    if (this.lastMs === null || atMs - this.lastMs >= QUIET_MS) this.push({ id: 0, kind: 'divider', text: utcHm(atMs) });
    this.lastMs = atMs;
    let last = this.all.at(-1);
    if (!last || last.kind !== 'text') {
      last = { id: this.nextId++, kind: 'text', text: '', kinds: '', firstMs: atMs, lastMs: atMs };
      this.all = [...this.all, last];
      this.trim();
    }
    if (ch === '\n') {
      this.all = [...this.all, { id: this.nextId++, kind: 'text', text: '', kinds: '', firstMs: atMs, lastMs: atMs }];
      this.trim();
      return true;
    }
    const line: TextLine = { ...last, text: last.text + ch, kinds: last.kinds + kind, firstMs: last.text ? last.firstMs : atMs, lastMs: atMs };
    this.all = [...this.all.slice(0, -1), line];
    return true;
  }

  /** Adds a divider, such as "40m · 7.0400" at a change of band. */
  divider(text: string) {
    this.push({ id: 0, kind: 'divider', text });
  }

  clear() {
    this.all = [];
    this.lastMs = null;
  }

  /**
   * Received text from `fromMs` on, as runs of received characters. A sent character or a new
   * line ends a run, so words never join across them.
   */
  rxSince(fromMs: number): RxRun[] {
    const out: RxRun[] = [];
    for (const l of this.all) {
      if (l.kind !== 'text' || l.lastMs < fromMs) continue;
      let run = '';
      for (let i = 0; i < l.text.length; i++) {
        const k = l.kinds[i];
        if (k === 't') {
          if (run.trim()) out.push({ text: run, atMs: l.firstMs });
          run = '';
        } else run += k === 'u' ? '�' : l.text[i];
      }
      if (run.trim()) out.push({ text: run, atMs: l.firstMs });
    }
    return out;
  }

  private push(line: Line) {
    const last = this.all.at(-1);
    // A divider ends the line before it; an empty text line before a divider is dropped.
    const base = last && last.kind === 'text' && last.text === '' ? this.all.slice(0, -1) : this.all;
    this.all = [...base, { ...line, id: this.nextId++ }];
    this.trim();
  }

  private trim() {
    if (this.all.length > KEEP_LINES) this.all = this.all.slice(this.all.length - KEEP_LINES);
  }
}
