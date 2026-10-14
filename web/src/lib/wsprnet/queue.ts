// The WSPRnet records waiting to go. Each slot's records go a random 0 to 20 s after the slot
// was decoded, one every 200 ms at most, as WSJT-X sends them. WSPRnet's answer cannot be read
// from a web page (it sends no CORS headers), so a record counts as sent once the request went
// out. A record that never left this phone (no network) goes again after 2, 4, 8, 16 and 30 min;
// one that went out is never sent twice, since WSPRnet may have stored it.

/** Shortest time between two records, ms. */
export const SPACING_MS = 200;
/** Longest random wait before a slot's records go, ms. */
export const JITTER_MS = 20_000;
/** Waits before the tries after a network failure, ms. */
export const RETRY_MS = [2, 4, 8, 16, 30].map((m) => m * 60_000);
/** Most records kept; the oldest go first. */
export const KEEP = 500;

/** Sends one record; rejects when the request did not go out. */
export type Post = (body: string) => Promise<void>;

export interface QueueEvents {
  sent(body: string, atMs: number): void;
  failed(body: string, e: unknown, final: boolean): void;
}

interface Item {
  body: string;
  dueMs: number;
  tries: number;
}

export class WsprnetQueue {
  private items: Item[] = [];
  private lastMs = -Infinity;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly post: Post,
    private readonly events: QueueEvents,
    private readonly now: () => number = () => Date.now(),
    private readonly random: () => number = Math.random,
  ) {}

  get waiting(): number {
    return this.items.length;
  }

  /** Queues one slot's records, to go after the random wait. */
  addSlot(bodies: readonly string[]) {
    if (!bodies.length) return;
    const due = this.now() + Math.floor(this.random() * (JITTER_MS + 1));
    for (const body of bodies) this.items.push({ body, dueMs: due, tries: 0 });
    if (this.items.length > KEEP) this.items.splice(0, this.items.length - KEEP);
    this.schedule();
  }

  clear() {
    this.items = [];
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.items.length) return;
    const next = Math.min(...this.items.map((i) => i.dueMs));
    const at = Math.max(next, this.lastMs + SPACING_MS);
    this.timer = setTimeout(() => this.fire(), Math.max(0, at - this.now()));
  }

  private fire() {
    this.timer = null;
    const now = this.now();
    let pick = -1;
    for (let i = 0; i < this.items.length; i++) if (this.items[i].dueMs <= now && (pick < 0 || this.items[i].dueMs < this.items[pick].dueMs)) pick = i;
    if (pick >= 0 && now >= this.lastMs + SPACING_MS) {
      const item = this.items.splice(pick, 1)[0];
      this.lastMs = now;
      item.tries++;
      this.post(item.body).then(
        () => this.events.sent(item.body, this.now()),
        (e: unknown) => {
          const wait = RETRY_MS[item.tries - 1];
          if (wait === undefined) {
            this.events.failed(item.body, e, true);
            return;
          }
          this.events.failed(item.body, e, false);
          this.items.push({ ...item, dueMs: this.now() + wait });
          this.schedule();
        },
      );
    }
    this.schedule();
  }
}
