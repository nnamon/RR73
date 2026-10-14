import { describe, expect, it } from 'vitest';
import { reconcile, UNDO_MS, type DestinationFacts, type Receipt } from './ledger';
import { HEARTBEAT_MS, Outbox, type Clock, type SendingDestination } from './outbox';
import { createQso } from './qso';
import type { DestinationId, LedgerEntry, Qso } from './types';

const T0 = Date.UTC(2026, 9, 13, 13, 0, 0);

/** Lets promise chains (sends, commits) run to completion. */
async function settle() {
  for (let i = 0; i < 30; i++) await new Promise<void>((r) => setImmediate(r));
}

class FakeClock implements Clock {
  t = T0;
  private timers: { at: number; fn: () => void; id: number }[] = [];
  private seq = 0;
  now() {
    return this.t;
  }
  setTimeout(fn: () => void, ms: number) {
    const id = ++this.seq;
    this.timers.push({ at: this.t + ms, fn, id });
    return id;
  }
  clearTimeout(h: unknown) {
    this.timers = this.timers.filter((x) => x.id !== h);
  }
  /** Moves time forward, firing timers in order and letting each run finish. */
  async advance(ms: number) {
    const end = this.t + ms;
    await settle();
    for (;;) {
      const next = this.timers.filter((x) => x.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      this.timers = this.timers.filter((x) => x !== next);
      this.t = next.at;
      next.fn();
      await settle();
    }
    this.t = end;
    await settle();
  }
}

type Behaviour = (q: Qso, call: number) => Receipt | Promise<Receipt>;

const delivered = (q: Qso): Receipt => ({ qsoId: q.id, outcome: 'delivered', remoteRef: null, duplicate: false });
const offline = (q: Qso): Receipt => ({ qsoId: q.id, outcome: 'retry', message: 'Could not reach Wavelog.', timeout: false, retryAfterMs: null });

/** An in-memory log with one or more fake destinations behind an outbox. */
function harness(opts: { behaviour?: Behaviour; dests?: DestinationId[] } = {}) {
  const clock = new FakeClock();
  const qsos = new Map<string, Qso>();
  let entries: LedgerEntry[] = [];
  const calls: { dest: DestinationId; qsoId: string; at: number }[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  let behaviour: Behaviour = opts.behaviour ?? delivered;
  let net = true;
  const facts = (id: DestinationId): DestinationFacts => ({ id, name: 'Wavelog', transport: 'direct', active: true, canUpdate: false });
  const ids = opts.dests ?? ['wavelog'];
  const dests: SendingDestination[] = ids.map((id) => ({
    id,
    async send(list) {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      const out: Receipt[] = [];
      for (const q of list) {
        calls.push({ dest: id, qsoId: q.id, at: clock.now() });
        out.push(await behaviour(q, calls.length));
      }
      inFlight--;
      return out;
    },
  }));
  const put = (changed: LedgerEntry[]) => {
    const key = (e: LedgerEntry) => `${e.qsoId}|${e.destinationId}`;
    const m = new Map(entries.map((e) => [key(e), e]));
    for (const e of changed) m.set(key(e), e);
    entries = [...m.values()];
  };
  const outbox = new Outbox({
    clock,
    online: () => net,
    destinations: () => dests,
    entries: () => entries,
    qso: (id) => qsos.get(id),
    settle: (e) => reconcile({ entry: e, dest: facts(e.destinationId), qso: qsos.get(e.qsoId)!, activation: null, sendEdits: true, sendAutomatically: true, now: clock.now() }) ?? e,
    commit: async (changed) => put(changed),
  });
  let n = 0;
  return {
    clock,
    outbox,
    calls,
    get maxInFlight() {
      return maxInFlight;
    },
    entry: (qsoId: string, dest: DestinationId = 'wavelog') => entries.find((e) => e.qsoId === qsoId && e.destinationId === dest)!,
    set behaviour(b: Behaviour) {
      behaviour = b;
    },
    set online(v: boolean) {
      net = v;
    },
    put,
    /** Logs a QSO now, as the store does: stored, then an entry per destination, then a kick. */
    log(startOffsetMs = 0): Qso {
      const q = createQso(
        { call: `K${++n}AA`, mode: 'FT8', band: '20m', dialHz: 14_074_000, audioHz: 1500, startUtcMs: clock.now() - 60_000 + startOffsetMs, endUtcMs: clock.now(), reportSent: -10, reportRcvd: -12 },
        { id: `q${n}`, now: clock.now(), activation: null, callsign: '9V1NE' },
      );
      qsos.set(q.id, q);
      put(ids.map((id) => reconcile({ entry: null, dest: facts(id), qso: q, activation: null, sendEdits: true, sendAutomatically: true, now: clock.now() })!));
      outbox.kick();
      return q;
    },
    change(q: Qso) {
      qsos.set(q.id, q);
      put(ids.map((id) => reconcile({ entry: entries.find((e) => e.qsoId === q.id && e.destinationId === id) ?? null, dest: facts(id), qso: q, activation: null, sendEdits: true, sendAutomatically: true, now: clock.now() })!));
      outbox.kick();
    },
  };
}

describe('outbox', () => {
  it('holds a new QSO for Undo, then sends it once', async () => {
    const h = harness();
    h.outbox.start();
    const q = h.log();
    await h.clock.advance(UNDO_MS - 1);
    expect(h.calls).toEqual([]);
    await h.clock.advance(1);
    expect(h.calls).toEqual([{ dest: 'wavelog', qsoId: q.id, at: T0 + UNDO_MS }]);
    expect(h.entry(q.id)).toMatchObject({ state: 'delivered', attempts: 1, deliveredAt: T0 + UNDO_MS });
    await h.clock.advance(10 * HEARTBEAT_MS);
    expect(h.calls).toHaveLength(1);
  });

  it('sends nothing for a QSO undone within the hold', async () => {
    const h = harness();
    h.outbox.start();
    const q = h.log();
    await h.clock.advance(3000);
    h.change({ ...q, deletedAt: h.clock.now(), updatedAt: h.clock.now() });
    await h.clock.advance(5 * 60_000);
    expect(h.calls).toEqual([]);
    expect(h.entry(q.id).state).toBe('not-needed');
  });

  it('sends oldest first, one request at a time per destination', async () => {
    const h = harness({ behaviour: async (q) => (await new Promise((r) => setImmediate(r)), delivered(q)) });
    h.online = false;
    h.outbox.start();
    const newest = h.log(0);
    const oldest = h.log(-600_000);
    const middle = h.log(-300_000);
    await h.clock.advance(UNDO_MS);
    expect(h.calls).toEqual([]);
    h.online = true;
    h.outbox.online();
    await h.clock.advance(0);
    expect(h.calls.map((c) => c.qsoId)).toEqual([oldest.id, middle.id, newest.id]);
    expect(h.maxInFlight).toBe(1);
  });

  it('runs destinations side by side', async () => {
    const h = harness({ dests: ['wavelog', 'pota-file'], behaviour: async (q) => (await new Promise((r) => setImmediate(r)), delivered(q)) });
    h.outbox.start();
    h.log();
    await h.clock.advance(UNDO_MS);
    expect(h.calls.map((c) => c.dest).sort()).toEqual(['pota-file', 'wavelog']);
    expect(h.maxInFlight).toBe(2);
  });

  it('backs off 30 s doubling to 30 min after failures, then delivers', async () => {
    const h = harness({ behaviour: offline });
    h.outbox.start();
    const q = h.log();
    await h.clock.advance(UNDO_MS);
    const gaps: number[] = [];
    for (let i = 0; i < 8; i++) {
      const before = h.calls.length;
      while (h.calls.length === before) await h.clock.advance(1000);
      gaps.push((h.calls.at(-1)!.at - h.calls.at(-2)!.at) / 1000);
    }
    expect(gaps).toEqual([30, 60, 120, 240, 480, 960, 1800, 1800]);
    expect(h.entry(q.id)).toMatchObject({ state: 'waiting', attempts: 9, lastError: 'Could not reach Wavelog.' });
    expect(h.outbox.statusOf('wavelog')).toMatchObject({ failures: 9, lastError: 'Could not reach Wavelog.' });
    h.behaviour = delivered;
    await h.clock.advance(1800_000);
    expect(h.entry(q.id).state).toBe('delivered');
    expect(h.outbox.statusOf('wavelog')).toMatchObject({ failures: 0, pausedUntil: 0, lastError: null });
  });

  it('waits as long as the destination asks', async () => {
    const h = harness({ behaviour: (q) => ({ qsoId: q.id, outcome: 'retry', message: 'Wait', timeout: false, retryAfterMs: 120_000 }) });
    h.outbox.start();
    h.log();
    await h.clock.advance(UNDO_MS);
    h.behaviour = delivered;
    await h.clock.advance(119_000);
    expect(h.calls).toHaveLength(1);
    await h.clock.advance(1000);
    expect(h.calls).toHaveLength(2);
  });

  it('pauses the whole destination after a failure and sends the rest once it recovers', async () => {
    const h = harness({ behaviour: offline });
    h.outbox.start();
    const a = h.log(-120_000);
    const b = h.log(-60_000);
    await h.clock.advance(UNDO_MS);
    expect(h.calls.map((c) => c.qsoId)).toEqual([a.id]);
    h.behaviour = delivered;
    await h.clock.advance(30_000);
    expect(h.calls.map((c) => c.qsoId)).toEqual([a.id, a.id, b.id]);
    expect([h.entry(a.id).state, h.entry(b.id).state]).toEqual(['delivered', 'delivered']);
  });

  it('does not run offline, and sends at once when the phone comes online', async () => {
    const h = harness({ behaviour: offline });
    h.outbox.start();
    h.log();
    await h.clock.advance(UNDO_MS);
    expect(h.calls).toHaveLength(1);
    h.online = false;
    await h.clock.advance(3_600_000);
    expect(h.calls).toHaveLength(1);
    h.behaviour = delivered;
    h.online = true;
    h.outbox.online();
    await h.clock.advance(0);
    expect(h.calls).toHaveLength(2);
    expect(h.outbox.statusOf('wavelog').failures).toBe(0);
  });

  it('refuses every waiting QSO for a destination-wide refusal and sends none until requeued', async () => {
    const key: Behaviour = (q) => ({ qsoId: q.id, outcome: 'refused', message: 'Wavelog refused the API key.', refusal: { fix: 'wavelog-key', scope: 'destination' } });
    const h = harness({ behaviour: key });
    h.outbox.start();
    const a = h.log(-120_000);
    const b = h.log(-60_000);
    const c = h.log();
    await h.clock.advance(UNDO_MS);
    expect(h.calls.map((x) => x.qsoId)).toEqual([a.id]);
    for (const q of [a, b, c]) expect(h.entry(q.id)).toMatchObject({ state: 'refused', lastError: 'Wavelog refused the API key.' });
    await h.clock.advance(3_600_000);
    expect(h.calls).toHaveLength(1);
    // The operator fixes the key: the store requeues them.
    h.behaviour = delivered;
    h.put([a, b, c].map((q) => ({ ...h.entry(q.id), state: 'waiting', nextAttemptAt: h.clock.now(), refusal: null })));
    h.outbox.kick();
    await h.clock.advance(0);
    expect(h.calls.map((x) => x.qsoId)).toEqual([a.id, a.id, b.id, c.id]);
  });

  it('goes on to the next QSO after a refusal of one QSO', async () => {
    const h = harness({ behaviour: (q, n) => (n === 1 ? { qsoId: q.id, outcome: 'refused', message: 'Bad band', refusal: { fix: 'resend', scope: 'qso' } } : delivered(q)) });
    h.outbox.start();
    const a = h.log(-60_000);
    const b = h.log();
    await h.clock.advance(UNDO_MS);
    expect(h.entry(a.id).state).toBe('refused');
    expect(h.entry(b.id).state).toBe('delivered');
  });

  it('counts a duplicate after a timeout as delivered', async () => {
    const h = harness({ behaviour: (q) => ({ qsoId: q.id, outcome: 'retry', message: 'Slow', timeout: true, retryAfterMs: null }) });
    h.outbox.start();
    const q = h.log();
    await h.clock.advance(UNDO_MS);
    expect(h.entry(q.id).possibleDuplicate).toBe(true);
    h.behaviour = (x) => ({ qsoId: x.id, outcome: 'delivered', remoteRef: null, duplicate: true });
    await h.clock.advance(30_000);
    expect(h.entry(q.id)).toMatchObject({ state: 'delivered', duplicate: true, possibleDuplicate: false, attempts: 2 });
  });

  it('marks a QSO deleted or edited while its request was out as changed', async () => {
    let release: () => void = () => undefined;
    const h = harness({ behaviour: (q) => new Promise<Receipt>((r) => (release = () => r(delivered(q)))) });
    h.outbox.start();
    const a = h.log(-60_000);
    const b = h.log();
    await h.clock.advance(UNDO_MS);
    h.change({ ...a, deletedAt: h.clock.now(), updatedAt: h.clock.now() + 1 });
    release();
    await h.clock.advance(0);
    expect(h.entry(a.id)).toMatchObject({ state: 'changed', lastError: 'Deleted on this phone after Wavelog received it. Delete it in Wavelog too, then mark it handled.' });
    h.change({ ...b, gridsquare: 'QF56', updatedAt: h.clock.now() + 2 });
    release();
    await h.clock.advance(0);
    expect(h.entry(b.id).state).toBe('changed');
  });

  it('sends nothing by itself when stopped; Send now sends everything waiting, held QSOs too', async () => {
    const h = harness();
    const q = h.log();
    await h.clock.advance(10 * HEARTBEAT_MS);
    expect(h.calls).toEqual([]);
    const r = h.log();
    await h.outbox.sendNow();
    await h.clock.advance(0);
    expect(h.calls.map((c) => c.qsoId).sort()).toEqual([q.id, r.id].sort());
    h.outbox.start();
    h.outbox.stop();
    expect(h.outbox.running).toBe(false);
  });

  it('turns a throwing destination into a retry', async () => {
    const h = harness({
      behaviour: () => {
        throw new Error('boom');
      },
    });
    h.outbox.start();
    const q = h.log();
    await h.clock.advance(UNDO_MS);
    expect(h.entry(q.id)).toMatchObject({ state: 'waiting', attempts: 1, lastError: 'The destination gave no answer. RR73 tries again later.' });
  });

  it('never sends a QSO that is not sent, even on Send now, until it is queued', async () => {
    const h = harness();
    h.outbox.start();
    const q = h.log();
    h.put([{ ...h.entry(q.id), state: 'not-sent', nextAttemptAt: null }]);
    await h.clock.advance(10 * HEARTBEAT_MS);
    await h.outbox.sendNow();
    await h.clock.advance(0);
    expect(h.calls).toEqual([]);
    h.put([{ ...h.entry(q.id), state: 'waiting', nextAttemptAt: h.clock.now() }]);
    await h.outbox.sendNow();
    expect(h.calls.map((c) => c.qsoId)).toEqual([q.id]);
  });

  it('runs a Send now that arrives during a run once that run ends', async () => {
    let release: () => void = () => undefined;
    const h = harness({ behaviour: (q) => new Promise<Receipt>((r) => (release = () => r(delivered(q)))) });
    h.outbox.start();
    const a = h.log(-60_000);
    await h.clock.advance(UNDO_MS);
    expect(h.calls.map((c) => c.qsoId)).toEqual([a.id]);
    // A QSO still held for Undo, queued by the operator while the first request is out.
    const b = h.log();
    const now = h.outbox.sendNow();
    release();
    await h.clock.advance(0);
    release();
    await now;
    expect(h.calls.map((c) => c.qsoId)).toEqual([a.id, b.id]);
    expect([h.entry(a.id).state, h.entry(b.id).state]).toEqual(['delivered', 'delivered']);
  });
});
