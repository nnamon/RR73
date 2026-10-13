import { describe, expect, it } from 'vitest';
import {
  applyReceipt,
  backoffMs,
  earliestAttempt,
  emptyEntry,
  fileParts,
  markHandled,
  markSubmitted,
  parsePartKey,
  partKey,
  pickNext,
  reconcile,
  refuseWaiting,
  requeue,
  retry,
  UNDO_MS,
  type DestinationFacts,
} from './ledger';
import { createQso } from './qso';
import type { Activation, LedgerEntry, Qso } from './types';

const T = Date.UTC(2026, 9, 13, 13, 0, 0);
const WAVELOG: DestinationFacts = { id: 'wavelog', name: 'Wavelog', transport: 'direct', active: true, canUpdate: false };
const UPDATING: DestinationFacts = { ...WAVELOG, canUpdate: true };
const POTA: DestinationFacts = { id: 'pota-file', name: 'POTA', transport: 'file', active: true, canUpdate: false };
const SOTA: DestinationFacts = { id: 'sota-file', name: 'SOTA', transport: 'file', active: true, canUpdate: false };

const ACT: Activation = {
  id: 'act',
  refs: [
    { programme: 'POTA', ref: 'VK-0921' },
    { programme: 'POTA', ref: 'VK-0922' },
  ],
  callsign: 'VK3/9V1NE',
  operator: '9V1NE',
  grid: 'QF22',
  gridSource: 'typed',
  wavelogStationId: null,
  startedAt: T,
  endedAt: null,
  updatedAt: T,
};

function qso(id: string, startMs = T, activation: Activation | null = null): Qso {
  return createQso(
    { call: 'VK2ESN', mode: 'FT8', band: '20m', dialHz: 14_074_000, audioHz: 1500, startUtcMs: startMs, endUtcMs: startMs + 60_000, reportSent: -12, reportRcvd: -10 },
    { id, now: startMs + 60_000, activation, callsign: '9V1NE' },
  );
}

const run = (entry: LedgerEntry | null, q: Qso, dest = WAVELOG, opts: { activation?: Activation | null; sendEdits?: boolean; now?: number } = {}) =>
  reconcile({ entry, dest, qso: q, activation: opts.activation ?? null, sendEdits: opts.sendEdits ?? true, now: opts.now ?? q.updatedAt });

const edit = (q: Qso, at: number, patch: Partial<Qso> = {}): Qso => ({ ...q, ...patch, updatedAt: at });
const del = (q: Qso, at: number): Qso => ({ ...q, deletedAt: at, updatedAt: at });

function delivered(q: Qso): LedgerEntry {
  const e = run(null, q)!;
  return applyReceipt(e, { qsoId: q.id, outcome: 'delivered', remoteRef: null, duplicate: false }, q.updatedAt, q.updatedAt + 20_000, 0);
}

describe('backoff', () => {
  it('waits 30 s after a failure, doubling to 30 min', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 20].map((n) => backoffMs(n) / 1000)).toEqual([0, 30, 60, 120, 240, 480, 960, 1800, 1800, 1800]);
  });
});

describe('a new QSO', () => {
  it('waits in the outbox, held for Undo', () => {
    const q = qso('q1');
    expect(run(null, q)).toMatchObject({ qsoId: 'q1', destinationId: 'wavelog', state: 'waiting', attempts: 0, nextAttemptAt: q.createdAt + UNDO_MS });
  });

  it('is sent at once when a destination is switched on later', () => {
    const q = qso('q1');
    expect(run(null, q, WAVELOG, { now: T + 3_600_000 })?.nextAttemptAt).toBe(T + 3_600_000);
  });

  it('gets no entry at a destination that is off, or when deleted', () => {
    const q = qso('q1');
    expect(run(null, q, { ...WAVELOG, active: false })).toBeNull();
    expect(run(null, del(q, T + 70_000))).toBeNull();
  });

  it('is file ready for each park and UTC day of its activation, and not needed elsewhere', () => {
    const q = qso('q1', T, ACT);
    expect(run(null, q, POTA, { activation: ACT })).toMatchObject({
      state: 'file-ready',
      parts: [
        { key: 'pota|VK-0921|20261013', submittedAt: null },
        { key: 'pota|VK-0922|20261013', submittedAt: null },
      ],
    });
    expect(run(null, q, SOTA, { activation: ACT })).toMatchObject({ state: 'not-needed', parts: [] });
    expect(run(null, qso('q2'), POTA)).toMatchObject({ state: 'not-needed' });
  });
});

describe('file parts', () => {
  const sota: Activation = { ...ACT, refs: [{ programme: 'SOTA', ref: 'VK3/VC-012' }, { programme: 'WWFF', ref: 'VKFF-0921' }] };
  it('names one file per summit and UTC day, per WWFF reference and activation, per activation for ADIF', () => {
    const q = qso('q1', Date.UTC(2026, 9, 13, 23, 59), sota);
    const next = qso('q2', Date.UTC(2026, 9, 14, 0, 1), sota);
    expect(fileParts('sota-file', q, sota)).toEqual(['sota|VK3/VC-012|20261013']);
    expect(fileParts('sota-file', next, sota)).toEqual(['sota|VK3/VC-012|20261014']);
    expect(fileParts('wwff-file', q, sota)).toEqual(['wwff|VKFF-0921|act']);
    expect(fileParts('wwff-file', next, sota)).toEqual(['wwff|VKFF-0921|act']);
    expect(fileParts('adif-file', q, sota)).toEqual(['adif|act']);
    expect(fileParts('pota-file', q, sota)).toEqual([]);
    expect(fileParts('adif-file', qso('q3'), sota)).toEqual([]);
  });

  it('round-trips keys', () => {
    for (const k of ['pota|VK-0921|20261013', 'sota|VK3/VC-012|20261013', 'wwff|VKFF-0921|act', 'adif|act']) {
      expect(partKey(parsePartKey(k)!)).toBe(k);
    }
    expect(parsePartKey('nonsense')).toBeNull();
  });
});

describe('Undo, delete and restore', () => {
  it('takes a waiting QSO out of the outbox and puts it back', () => {
    const q = qso('q1');
    const waiting = run(null, q)!;
    const undone = run(waiting, del(q, T + 61_000))!;
    expect(undone).toMatchObject({ state: 'not-needed', nextAttemptAt: null });
    const back = run(undone, edit(q, T + 62_000, { deletedAt: null }), WAVELOG, { now: T + 62_000 })!;
    expect(back).toMatchObject({ state: 'waiting', nextAttemptAt: q.createdAt + UNDO_MS });
  });

  it('marks a delivered QSO that is deleted as changed, so the operator deletes it there too', () => {
    const q = qso('q1');
    const d = delivered(q);
    const gone = run(d, del(q, T + 100_000))!;
    expect(gone.state).toBe('changed');
    expect(gone.lastError).toBe('Deleted on this phone after Wavelog received it. Delete it in Wavelog too, then mark it handled.');
    const handled = markHandled(gone, del(q, T + 100_000), null);
    expect(handled).toMatchObject({ state: 'not-needed', deliveredAt: null });
    expect(run(handled, del(q, T + 100_000))).toEqual(handled);
    // Restored after the operator deleted it in Wavelog: it goes again.
    expect(run(handled, edit(q, T + 200_000), WAVELOG, { now: T + 200_000 })?.state).toBe('waiting');
  });
});

describe('edits', () => {
  it('marks a delivered QSO changed when Wavelog cannot take changes', () => {
    const q = qso('q1');
    const d = delivered(q);
    expect(run(d, q)).toEqual(d);
    const changed = run(d, edit(q, T + 100_000, { gridsquare: 'QF57' }))!;
    expect(changed.state).toBe('changed');
    expect(changed.lastError).toBe('Edited after Wavelog received it. Wavelog does not take changes from RR73: make the same edit in Wavelog, then mark it handled.');
    const handled = markHandled(changed, edit(q, T + 100_000), null);
    expect(handled).toMatchObject({ state: 'delivered', deliveredUpdatedAt: T + 100_000, lastError: null });
  });

  it('sends the edit again where the destination takes changes and the setting allows it', () => {
    const q = qso('q1');
    const d = delivered(q);
    expect(run(d, edit(q, T + 100_000), UPDATING, { now: T + 100_000 })).toMatchObject({ state: 'waiting', nextAttemptAt: T + 100_000 });
    expect(run(d, edit(q, T + 100_000), UPDATING, { sendEdits: false })?.state).toBe('changed');
  });

  it('sends a QSO refused for its content again after an edit', () => {
    const q = qso('q1');
    const refused = applyReceipt(run(null, q)!, { qsoId: 'q1', outcome: 'refused', message: 'bad', refusal: { fix: 'edit-qso', scope: 'qso' } }, q.updatedAt, T + 80_000, 0);
    expect(run(refused, q)).toEqual(refused);
    expect(run(refused, edit(q, T + 90_000), WAVELOG, { now: T + 90_000 })).toMatchObject({ state: 'waiting', attempts: 0, lastError: null, refusal: null });
    const key = { ...refused, refusal: { fix: 'wavelog-key', scope: 'destination' } } as LedgerEntry;
    expect(run(key, edit(q, T + 90_000))?.state).toBe('refused');
  });
});

describe('receipts', () => {
  const q = qso('q1');
  const w = run(null, q)!;

  it('records a delivery with the QSO version that was sent', () => {
    const d = applyReceipt(w, { qsoId: 'q1', outcome: 'delivered', remoteRef: '123', duplicate: false }, q.updatedAt, T + 80_000, 0);
    expect(d).toMatchObject({ state: 'delivered', attempts: 1, lastAttemptAt: T + 80_000, deliveredAt: T + 80_000, deliveredUpdatedAt: q.updatedAt, remoteRef: '123', nextAttemptAt: null });
    // Edited while the request was out: changed once settled.
    expect(run(d, edit(q, T + 79_000))?.state).toBe('changed');
  });

  it('keeps a failed QSO waiting, flags a timeout as a possible duplicate, then takes the duplicate as delivered', () => {
    const t = applyReceipt(w, { qsoId: 'q1', outcome: 'retry', message: 'slow', timeout: true, retryAfterMs: null }, q.updatedAt, T + 80_000, T + 110_000);
    expect(t).toMatchObject({ state: 'waiting', attempts: 1, nextAttemptAt: T + 110_000, lastError: 'slow', possibleDuplicate: true });
    const net = applyReceipt(t, { qsoId: 'q1', outcome: 'retry', message: 'offline', timeout: false, retryAfterMs: null }, q.updatedAt, T + 110_000, T + 170_000);
    expect(net).toMatchObject({ attempts: 2, possibleDuplicate: true });
    const dup = applyReceipt(net, { qsoId: 'q1', outcome: 'delivered', remoteRef: null, duplicate: true }, q.updatedAt, T + 170_000, 0);
    expect(dup).toMatchObject({ state: 'delivered', duplicate: true, possibleDuplicate: false, attempts: 3, lastError: null });
  });

  it('stops retrying a refusal', () => {
    const r = applyReceipt(w, { qsoId: 'q1', outcome: 'refused', message: 'no', refusal: { fix: 'wavelog-key', scope: 'destination' } }, q.updatedAt, T + 80_000, 0);
    expect(r).toMatchObject({ state: 'refused', nextAttemptAt: null, lastError: 'no', refusal: { fix: 'wavelog-key', scope: 'destination' } });
    expect(retry(r, T + 90_000)).toMatchObject({ state: 'waiting', attempts: 0, nextAttemptAt: T + 90_000, refusal: null });
    expect(retry(w, T)).toBe(w);
  });

  it('refuses every waiting QSO for a destination-wide reason, and requeues them after a fix', () => {
    const entries = ['a', 'b', 'c'].map((id) => run(null, qso(id))!);
    const done = { ...entries[2], state: 'delivered' } as LedgerEntry;
    const other = { ...emptyEntry('a', 'pota-file'), state: 'file-ready' } as LedgerEntry;
    const refused = refuseWaiting([entries[0], entries[1], done, other], 'wavelog', 'key', { fix: 'wavelog-key', scope: 'destination' });
    expect(refused.map((e) => [e.qsoId, e.state])).toEqual([
      ['a', 'refused'],
      ['b', 'refused'],
    ]);
    const back = requeue([...refused, done], 'wavelog', T + 5000, (e) => e.qsoId === 'a');
    expect(back.map((e) => [e.qsoId, e.state, e.nextAttemptAt])).toEqual([['a', 'waiting', T + 5000]]);
  });
});

describe('files', () => {
  const q = qso('q1', T, ACT);
  const ready = run(null, q, POTA, { activation: ACT })!;

  it('moves to submitted once every file holding the QSO is submitted', () => {
    const one = markSubmitted(ready, 'pota|VK-0921|20261013', q, T + 3_600_000);
    expect(one.state).toBe('file-ready');
    expect(run(one, q, POTA, { activation: ACT })?.state).toBe('file-ready');
    const both = markSubmitted(one, 'pota|VK-0922|20261013', q, T + 3_700_000);
    expect(both).toMatchObject({ state: 'submitted', deliveredUpdatedAt: q.updatedAt });
    expect(run(both, q, POTA, { activation: ACT })).toEqual(both);
    expect(markSubmitted(ready, 'pota|XX-0000|20261013', q, T)).toBe(ready);
  });

  it('marks a submitted QSO changed after an edit, and submitted again once handled', () => {
    const sub = markSubmitted(markSubmitted(ready, 'pota|VK-0921|20261013', q, T + 1), 'pota|VK-0922|20261013', q, T + 2);
    const edited = edit(q, T + 5_000_000, { rstSent: '-15' });
    const changed = run(sub, edited, POTA, { activation: ACT })!;
    expect(changed.state).toBe('changed');
    expect(changed.lastError).toBe('Edited after the POTA file was submitted. Submit a corrected file, then mark it handled.');
    const handled = markHandled(changed, edited, fileParts('pota-file', edited, ACT));
    expect(handled.state).toBe('submitted');
    expect(run(handled, edited, POTA, { activation: ACT })).toEqual(handled);
  });

  it('marks a submitted QSO changed when its activation loses the park, until handled', () => {
    const sub = markSubmitted(ready, 'pota|VK-0922|20261013', q, T + 1);
    const narrowed: Activation = { ...ACT, refs: [{ programme: 'POTA', ref: 'VK-0921' }] };
    const changed = run(sub, q, POTA, { activation: narrowed })!;
    expect(changed.state).toBe('changed');
    expect(run(changed, q, POTA, { activation: narrowed })?.state).toBe('changed');
    const handled = markHandled(changed, q, fileParts('pota-file', q, narrowed));
    expect(handled.parts).toEqual([{ key: 'pota|VK-0921|20261013', submittedAt: null }]);
    expect(run(handled, q, POTA, { activation: narrowed })?.state).toBe('file-ready');
  });

  it('drops a deleted QSO from its files, unless a file holding it was submitted', () => {
    const gone = del(q, T + 10_000);
    expect(run(ready, gone, POTA, { activation: ACT })).toMatchObject({ state: 'not-needed' });
    const sub = markSubmitted(ready, 'pota|VK-0921|20261013', q, T + 1);
    const changed = run(sub, gone, POTA, { activation: ACT })!;
    expect(changed.state).toBe('changed');
    expect(changed.lastError).toBe('Deleted after the POTA file was submitted. Remove it from the POTA log, then mark it handled.');
    const handled = markHandled(changed, gone, []);
    expect(handled.state).toBe('not-needed');
    expect(run(handled, gone, POTA, { activation: ACT })?.state).toBe('not-needed');
  });
});

describe('picking the next QSO', () => {
  const qs = [qso('late', T + 600_000), qso('early', T), qso('mid', T + 300_000)];
  const start = (id: string) => qs.find((q) => q.id === id)!.start;
  const entries = qs.map((q) => run(null, q)!);

  it('takes the oldest QSO that is due', () => {
    expect(pickNext(entries, 'wavelog', T + 10_000, start)).toBeNull();
    expect(pickNext(entries, 'wavelog', T + 400_000, start)?.qsoId).toBe('early');
    const rest = entries.filter((e) => e.qsoId !== 'early');
    expect(pickNext(rest, 'wavelog', T + 400_000, start)?.qsoId).toBe('mid');
    expect(pickNext(entries, 'pota-file', T + 10_000_000, start)).toBeNull();
  });

  it('takes held QSOs too when forced, and knows the earliest next attempt', () => {
    expect(pickNext(entries, 'wavelog', T, start, true)?.qsoId).toBe('early');
    expect(earliestAttempt(entries, ['wavelog'])).toBe(T + 60_000 + UNDO_MS);
    expect(earliestAttempt(entries, ['pota-file'])).toBeNull();
  });
});
