/**
 * The outbox: sends waiting ledger entries to direct destinations while RR73 is open and online.
 *
 * - Runs on start, when the phone comes online, after each new QSO, when a held or backed-off
 *   entry falls due, and every 60 s.
 * - One request at a time per destination, oldest QSO first. Destinations run side by side.
 * - After a failure the destination waits 30 s, doubling to 30 min, or longer when it asks to.
 *   Coming online clears the wait.
 * - A refusal stops nothing else unless it applies to the whole destination (a refused key, a
 *   missing station location): then every waiting QSO there is refused for the same reason, and
 *   none is sent until the operator acts.
 *
 * Time comes from an injected clock and storage from injected callbacks, so the tests drive it
 * with a fake clock.
 */

import { applyReceipt, backoffMs, earliestAttempt, pickNext, refuseWaiting, type Receipt } from './ledger';
import type { DestinationId, LedgerEntry, Qso } from './types';

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/** A destination with a direct or relay transport: log.md's LogDestination.send. */
export interface SendingDestination {
  id: DestinationId;
  send(qsos: Qso[]): Promise<Receipt[]>;
}

export interface OutboxDeps {
  clock: Clock;
  online(): boolean;
  /** Destinations switched on and set up. */
  destinations(): SendingDestination[];
  entries(): readonly LedgerEntry[];
  qso(id: string): Qso | undefined;
  /** The entry reconciled with the QSO as it is now, catching edits and deletes made while a request was in flight. */
  settle(entry: LedgerEntry): LedgerEntry;
  /** Stores changed entries. entries() returns them afterwards. */
  commit(changed: LedgerEntry[]): Promise<void>;
  /** Called when a destination's run state changes. */
  onStatus?(id: DestinationId, status: DestinationStatus): void;
}

export const HEARTBEAT_MS = 60_000;

export interface DestinationStatus {
  /** Consecutive failed sends. */
  failures: number;
  /** No sends before this time, UTC ms; 0 when not waiting. */
  pausedUntil: number;
  /** Why the last send failed, in plain words, until one succeeds. */
  lastError: string | null;
  sending: boolean;
}

export class Outbox {
  private timer: unknown = null;
  private started = false;
  private status = new Map<DestinationId, DestinationStatus>();
  private forced = new Set<DestinationId>();

  constructor(private readonly deps: OutboxDeps) {}

  get running(): boolean {
    return this.started;
  }

  /** Starts sending by itself. */
  start(): void {
    if (this.started) return;
    this.started = true;
    void this.run();
  }

  /** Stops sending by itself; Send now still works. */
  stop(): void {
    this.started = false;
    this.clear();
  }

  /** The phone came online: clears every wait and sends. */
  online(): void {
    for (const [id, s] of this.status) this.update(id, { ...s, failures: 0, pausedUntil: 0 });
    if (this.started) void this.run();
  }

  /** Something changed (a new QSO, a requeue): sends what is due. */
  kick(): void {
    if (this.started) void this.run();
  }

  /** Send now: everything waiting, held and backed-off QSOs too, whether or not the outbox runs by itself. */
  sendNow(): Promise<void> {
    return this.run(true);
  }

  statusOf(id: DestinationId): DestinationStatus {
    return this.status.get(id) ?? { failures: 0, pausedUntil: 0, lastError: null, sending: false };
  }

  private update(id: DestinationId, s: DestinationStatus) {
    this.status.set(id, s);
    this.deps.onStatus?.(id, s);
  }

  private async run(force = false): Promise<void> {
    if (this.deps.online()) await Promise.all(this.deps.destinations().map((d) => this.drain(d, force)));
    this.schedule();
  }

  private async drain(d: SendingDestination, force: boolean): Promise<void> {
    if (this.statusOf(d.id).sending) {
      if (force) this.forced.add(d.id);
      return;
    }
    this.update(d.id, { ...this.statusOf(d.id), sending: true });
    try {
      for (;;) {
        if (!this.deps.online()) break;
        const now = this.deps.clock.now();
        const all = force || this.forced.has(d.id);
        if (!all && this.statusOf(d.id).pausedUntil > now) break;
        const entry = pickNext(this.deps.entries(), d.id, now, (id) => this.deps.qso(id)?.start ?? Infinity, all);
        if (!entry) break;
        const qso = this.deps.qso(entry.qsoId);
        if (!qso) {
          await this.deps.commit([{ ...entry, state: 'not-needed', nextAttemptAt: null }]);
          continue;
        }
        const sent = qso.updatedAt;
        let receipt: Receipt;
        try {
          receipt = (await d.send([qso])).find((r) => r.qsoId === qso.id) ?? noReply(qso.id);
        } catch {
          receipt = noReply(qso.id);
        }
        const at = this.deps.clock.now();
        const s = this.statusOf(d.id);
        let retryAt = at;
        if (receipt.outcome === 'retry') {
          const failures = s.failures + 1;
          retryAt = at + Math.max(backoffMs(failures), receipt.retryAfterMs ?? 0);
          this.update(d.id, { ...s, failures, pausedUntil: retryAt, lastError: receipt.message });
          this.forced.delete(d.id);
          force = false;
        } else {
          this.update(d.id, { ...s, failures: 0, pausedUntil: 0, lastError: null });
        }
        // The entry as it is now: the QSO may have been edited, deleted or undone while the request was out.
        const current = this.deps.entries().find((e) => e.qsoId === entry.qsoId && e.destinationId === d.id) ?? entry;
        const next = this.deps.settle(applyReceipt(current, receipt, sent, at, retryAt));
        const changed = [next];
        if (receipt.outcome === 'refused' && receipt.refusal.scope === 'destination') {
          changed.push(...refuseWaiting(this.deps.entries().filter((e) => e.qsoId !== next.qsoId), d.id, receipt.message, receipt.refusal));
        }
        await this.deps.commit(changed);
        if (receipt.outcome === 'retry' || (receipt.outcome === 'refused' && receipt.refusal.scope === 'destination')) break;
      }
    } finally {
      this.forced.delete(d.id);
      this.update(d.id, { ...this.statusOf(d.id), sending: false });
    }
  }

  /** Wakes at the next due entry or the end of a wait, and at least every 60 s. */
  private schedule() {
    this.clear();
    if (!this.started) return;
    const now = this.deps.clock.now();
    let wake = now + HEARTBEAT_MS;
    if (this.deps.online()) {
      for (const d of this.deps.destinations()) {
        // A destination still sending reschedules when its run ends.
        if (this.statusOf(d.id).sending) continue;
        const due = earliestAttempt(this.deps.entries(), [d.id]);
        if (due === null) continue;
        wake = Math.min(wake, Math.max(due, this.statusOf(d.id).pausedUntil));
      }
    }
    this.timer = this.deps.clock.setTimeout(() => void this.run(), Math.max(0, wake - now));
  }

  private clear() {
    if (this.timer !== null) this.deps.clock.clearTimeout(this.timer);
    this.timer = null;
  }
}

function noReply(qsoId: string): Receipt {
  return { qsoId, outcome: 'retry', message: 'The destination gave no answer. RR73 tries again later.', timeout: false, retryAfterMs: null };
}
