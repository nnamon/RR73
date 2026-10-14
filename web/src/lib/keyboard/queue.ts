/**
 * The send queue: text typed ahead of the transmitter. The text to send field shows it, and the
 * operator edits it there; the keyboard session takes characters from its front as the
 * transmitter needs them, so a character on its way to the air leaves the field. A character
 * already taken is on air and cannot come back.
 *
 * A mark rides on the queue at the end of some text (a macro with Log QSO when sent) and is
 * returned by take() once that text's last character has been taken. Edits before a mark move
 * it with the text; deleting the text it ends drops it.
 */

export class SendQueue<T = unknown> {
  private queued = '';
  /** Marks by the number of characters from the front that must be taken before they fire. */
  private marks: { end: number; payload: T }[] = [];

  /** The text waiting to be sent. */
  get text(): string {
    return this.queued;
  }

  get length(): number {
    return this.queued.length;
  }

  /** Marks waiting, for tests and the display. */
  get pending(): readonly T[] {
    return this.marks.map((m) => m.payload);
  }

  /** Adds `text` at the end, with a mark at its end when given. */
  append(text: string, mark?: T) {
    this.queued += text;
    if (mark !== undefined && text) this.marks.push({ end: this.queued.length, payload: mark });
  }

  /** Takes the operator's edit of the field as the new queue. Marks move with the text around the edit. */
  edit(next: string) {
    const old = this.queued;
    if (next === old) return;
    let p = 0;
    while (p < old.length && p < next.length && old[p] === next[p]) p++;
    let q = 0;
    while (q < old.length - p && q < next.length - p && old[old.length - 1 - q] === next[next.length - 1 - q]) q++;
    const oldEnd = old.length - q;
    const newEnd = next.length - q;
    this.queued = next;
    this.marks = this.marks
      .map((m) => ({ ...m, end: m.end <= p ? m.end : m.end >= oldEnd ? m.end + newEnd - oldEnd : newEnd }))
      .filter((m) => m.end > 0 && m.end <= next.length);
  }

  /** Removes the last character waiting; false when there is none. */
  backspace(): boolean {
    if (!this.queued) return false;
    this.edit(this.queued.slice(0, -1));
    return true;
  }

  clear() {
    this.queued = '';
    this.marks = [];
  }

  /** Takes up to `n` characters from the front, and the marks whose text they complete. */
  take(n: number): { text: string; marks: T[] } {
    const k = Math.max(0, Math.min(n, this.queued.length));
    const text = this.queued.slice(0, k);
    this.queued = this.queued.slice(k);
    const fired: T[] = [];
    const kept: { end: number; payload: T }[] = [];
    for (const m of this.marks) {
      if (m.end <= k) fired.push(m.payload);
      else kept.push({ ...m, end: m.end - k });
    }
    this.marks = kept;
    return { text, marks: fired };
  }
}
