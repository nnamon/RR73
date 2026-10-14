import { describe, expect, it } from 'vitest';
import { IGNORE_MS, LATE_S, notReady, ourSlot, reduce, type HuntOrder, type SeqState, type Worked } from './sequencer';
import { Sim, T0, decode } from '../testing/qso-sim';
import type { Decode } from '../decode/types';

const texts = (s: Sim) => s.sent.map((t) => `${t.slot}:${t.text}`);

describe('answering a CQ', () => {
  it('runs Tx1, Tx3 and Tx5 and logs on their RR73', () => {
    const s = new Sim();
    s.hear(1, [decode('CQ JA1KXM PM95', -12, 1418, 0.2)]);
    s.call(1, decode('CQ JA1KXM PM95', -12, 1418, 0.2));
    s.run(2, 2);
    s.run(3, 6, { 3: [decode('9V1NE JA1KXM -09', -11, 1418, 0.2)], 5: [decode('9V1NE JA1KXM RR73', -10, 1418, 0.2)] });
    // The report is the SNR of their latest decode when it first goes out: -11.
    expect(texts(s)).toEqual(['2:JA1KXM 9V1NE OJ11', '4:JA1KXM 9V1NE R-11', '6:JA1KXM 9V1NE 73']);
    const [rec] = s.logged();
    expect(rec).toEqual({
      call: 'JA1KXM',
      grid: 'PM95',
      mode: 'FT8',
      band: '20m',
      dialHz: 14_074_000,
      audioHz: 1500,
      startUtcMs: Date.UTC(2026, 9, 13, 13, 14, 30, 500),
      endUtcMs: Date.UTC(2026, 9, 13, 13, 15, 30, 100),
      reportSent: '-11',
      reportRcvd: '-09',
      source: 'sequencer',
      decode: { preset: 'subtract-3', snrDb: -10, dtS: 0.2, audioHz: 1418 },
      stationCallsign: '9V1NE',
      myGridsquare: 'OJ11',
    });
    // No activationId: the log attaches the running activation.
    expect('activationId' in rec).toBe(false);
    // After 73 the QSO is over and Tx is off, as WSJT-X does by default.
    expect(s.st).toMatchObject({ phase: 'idle', txEnabled: false, partner: null });
  });

  it('logs at the moment their RR73 is decoded, before our 73', () => {
    const s = new Sim();
    s.call(1, 'CQ JA1KXM PM95');
    s.run(2, 4, { 3: ['9V1NE JA1KXM -09'] });
    const fx = s.hear(5, ['9V1NE JA1KXM RR73']);
    expect(fx.map((f) => f.type)).toEqual(['logQso', 'scheduleTx']);
  });

  it('answers an R-report with Tx4 and logs once RR73 has gone out', () => {
    const s = new Sim();
    s.call(1, 'CQ JA1KXM PM95');
    s.run(2, 4, { 3: ['9V1NE JA1KXM R-05'] });
    expect(texts(s)).toEqual(['2:JA1KXM 9V1NE OJ11', '4:JA1KXM 9V1NE RR73']);
    expect(s.logged()).toHaveLength(1);
    expect(s.logged()[0]).toMatchObject({ reportRcvd: '-05', reportSent: '-10' });
    expect(s.st.phase).toBe('idle');
  });

  it('accepts RRR in place of RR73 and sends 73', () => {
    const s = new Sim();
    s.call(1, 'CQ JA1KXM PM95');
    s.run(2, 6, { 3: ['9V1NE JA1KXM -09'], 5: ['9V1NE JA1KXM RRR'] });
    expect(texts(s).at(-1)).toBe('6:JA1KXM 9V1NE 73');
    expect(s.logged()).toHaveLength(1);
  });

  it('logs on 73 after our R-report without sending 73 back', () => {
    const s = new Sim();
    s.call(1, 'CQ JA1KXM PM95');
    s.run(2, 6, { 3: ['9V1NE JA1KXM -09'], 5: ['9V1NE JA1KXM 73'] });
    expect(texts(s)).toEqual(['2:JA1KXM 9V1NE OJ11', '4:JA1KXM 9V1NE R-10']);
    expect(s.logged()).toHaveLength(1);
    expect(s.st.phase).toBe('idle');
  });

  it('does not log RR73 that comes before any report', () => {
    const s = new Sim();
    s.call(1, 'CQ JA1KXM PM95');
    s.run(2, 4, { 3: ['9V1NE JA1KXM RR73'] });
    expect(s.logged()).toEqual([]);
    expect(s.notices().map((n) => n.kind)).toContain('incomplete');
    expect(texts(s)).toEqual(['2:JA1KXM 9V1NE OJ11']);
  });

  it('repeats Tx3 when they send their report again', () => {
    const s = new Sim();
    s.call(1, 'CQ JA1KXM PM95');
    s.run(2, 8, { 3: ['9V1NE JA1KXM -09'], 5: ['9V1NE JA1KXM -09'], 7: ['9V1NE JA1KXM RR73'] });
    expect(texts(s)).toEqual(['2:JA1KXM 9V1NE OJ11', '4:JA1KXM 9V1NE R-10', '6:JA1KXM 9V1NE R-10', '8:JA1KXM 9V1NE 73']);
  });

  it('keeps the report it first sent', () => {
    const s = new Sim();
    s.call(1, decode('CQ JA1KXM PM95', -12));
    s.run(2, 6, { 3: [decode('9V1NE JA1KXM -09', -20)], 5: [decode('9V1NE JA1KXM -09', -3)] });
    expect(texts(s).slice(1)).toEqual(['4:JA1KXM 9V1NE R-20', '6:JA1KXM 9V1NE R-20']);
  });

  it('calls the sender of a message that is not a CQ', () => {
    const s = new Sim();
    s.call(1, 'JH1RRT YB0AZK RR73');
    s.run(2, 2);
    expect(texts(s)).toEqual(['2:YB0AZK 9V1NE OJ11']);
  });

  it('answers a station that calls us directly, by what they sent', () => {
    for (const [msg, want] of [
      ['9V1NE K1ABC FN42', 'K1ABC 9V1NE -10'],
      ['9V1NE K1ABC -07', 'K1ABC 9V1NE R-10'],
      ['9V1NE K1ABC R-07', 'K1ABC 9V1NE RR73'],
    ] as const) {
      const s = new Sim();
      s.call(1, msg);
      s.run(2, 2);
      expect(texts(s), msg).toEqual([`2:${want}`]);
    }
  });

  it('refuses to call a message with no other callsign', () => {
    const s = new Sim();
    s.call(1, 'CQ 9V1NE OJ11');
    expect(s.notices().map((n) => n.kind)).toEqual(['cannot-call']);
    expect(s.st.txEnabled).toBe(false);
  });
});

describe('retries', () => {
  it('repeats an unanswered message 3 times, then stops and keeps Tx enabled on it', () => {
    const s = new Sim();
    s.call(1, 'CQ JA1KXM PM95');
    s.run(2, 12);
    expect(texts(s)).toEqual(['2:JA1KXM 9V1NE OJ11', '4:JA1KXM 9V1NE OJ11', '6:JA1KXM 9V1NE OJ11', '8:JA1KXM 9V1NE OJ11']);
    expect(s.st).toMatchObject({ paused: true, txEnabled: true, current: 1 });
    expect(s.notices().at(-1)).toMatchObject({ kind: 'no-reply', text: 'No reply from JA1KXM' });
    // Calling again starts over.
    s.call(11, 'CQ JA1KXM PM95');
    s.run(12, 12);
    expect(texts(s).at(-1)).toBe('12:JA1KXM 9V1NE OJ11');
  });

  it('takes the retry limit from the configuration', () => {
    const s = new Sim({ maxRetries: 1 });
    s.call(1, 'CQ JA1KXM PM95');
    s.run(2, 8);
    expect(s.sent).toHaveLength(2);
  });

  it('does not count slots it did not transmit in', () => {
    const s = new Sim();
    s.call(1, 'CQ JA1KXM PM95');
    s.send({ type: 'enableTx', on: false, nowMs: s.at(2, 0.4) });
    s.run(2, 9);
    expect(s.sent).toEqual([]);
    s.send({ type: 'enableTx', on: true, nowMs: s.at(10, 0.1) });
    s.run(10, 10);
    expect(texts(s)).toEqual(['10:JA1KXM 9V1NE OJ11']);
    expect(s.st.retries).toBe(0);
  });
});

describe('calling CQ', () => {
  it('runs Tx6, Tx2 and Tx4 with a caller who sends a grid, logs after RR73, then calls CQ again with Run', () => {
    const s = new Sim({ run: true });
    s.send({ type: 'callCq', nowMs: s.at(0, 0.1) });
    s.run(0, 6, { 1: [decode('9V1NE K1ABC FN42', -8)], 3: [decode('9V1NE K1ABC R-14', -9)] });
    expect(texts(s)).toEqual(['0:CQ 9V1NE OJ11', '2:K1ABC 9V1NE -08', '4:K1ABC 9V1NE RR73', '6:CQ 9V1NE OJ11']);
    expect(s.logged()).toHaveLength(1);
    expect(s.logged()[0]).toMatchObject({ call: 'K1ABC', grid: 'FN42', reportSent: '-08', reportRcvd: '-14', startUtcMs: Date.UTC(2026, 9, 13, 13, 14, 30, 500) });
  });

  it('answers a caller who sends a report with Tx3, and an R-report with Tx4', () => {
    const a = new Sim();
    a.send({ type: 'callCq', nowMs: a.at(0, 0.1) });
    a.run(0, 4, { 1: ['9V1NE K1ABC -03'], 3: ['9V1NE K1ABC RR73'] });
    expect(texts(a)).toEqual(['0:CQ 9V1NE OJ11', '2:K1ABC 9V1NE R-10', '4:K1ABC 9V1NE 73']);
    expect(a.logged()).toHaveLength(1);

    const b = new Sim();
    b.send({ type: 'callCq', nowMs: b.at(0, 0.1) });
    b.run(0, 2, { 1: ['9V1NE K1ABC R-03'] });
    expect(texts(b)).toEqual(['0:CQ 9V1NE OJ11', '2:K1ABC 9V1NE RR73']);
    expect(b.logged()).toHaveLength(1);
  });

  it('repeats CQ while nobody answers', () => {
    const s = new Sim();
    s.send({ type: 'callCq', nowMs: s.at(0, 0.1) });
    s.run(0, 8);
    expect(texts(s)).toEqual(['0:CQ 9V1NE OJ11', '2:CQ 9V1NE OJ11', '4:CQ 9V1NE OJ11', '6:CQ 9V1NE OJ11', '8:CQ 9V1NE OJ11']);
  });

  it('uses the edited Tx6 with a modifier', () => {
    const s = new Sim({ cqModifier: 'POTA' });
    s.send({ type: 'callCq', nowMs: s.at(0, 0.1) });
    s.run(0, 0);
    expect(texts(s)).toEqual(['0:CQ POTA 9V1NE OJ11']);
    s.send({ type: 'editMessage', tx: 6, text: 'cq dx 9v1ne oj11', nowMs: s.at(1, 1) });
    s.run(1, 2);
    expect(texts(s).at(-1)).toBe('2:CQ DX 9V1NE OJ11');
  });
});

describe('Run mode', () => {
  const callers = [
    decode('9V1NE K1ABC FN42', -15, 600),
    decode('9V1NE JA1KXM PM95', -5, 900),
    decode('9V1NE VK3QRP QF22', -20, 1200),
    decode('9V1NE ZL1TQK RF70', -10, 1500),
  ];

  function run(order: 'first' | 'strongest' | 'farthest' | 'new', worked: string[] = []) {
    const s = new Sim({ order, run: true });
    if (worked.length) s.send({ type: 'setWorked', worked: worked.map((call) => ({ call, band: '40m', mode: 'FT8', day: '20261001', grid: null })), nowMs: s.at(0) });
    s.send({ type: 'callCq', nowMs: s.at(0, 0.1) });
    s.run(0, 2, { 1: callers });
    return s;
  }

  it('answers callers in the chosen order', () => {
    expect(texts(run('first')).at(-1)).toBe('2:K1ABC 9V1NE -15');
    expect(texts(run('strongest')).at(-1)).toBe('2:JA1KXM 9V1NE -05');
    // From OJ11: FN42 (Boston) about 15000 km, the farthest.
    expect(texts(run('farthest')).at(-1)).toBe('2:K1ABC 9V1NE -15');
    expect(texts(run('new', ['K1ABC', 'JA1KXM'])).at(-1)).toBe('2:VK3QRP 9V1NE -20');
  });

  it('keeps the other callers queued and works them one after another', () => {
    const s = new Sim({ order: 'first', run: true });
    s.send({ type: 'callCq', nowMs: s.at(0, 0.1) });
    s.run(0, 10, {
      1: callers.slice(0, 2),
      3: ['9V1NE K1ABC R-12'],
      5: ['9V1NE JA1KXM PM95'],
      7: ['9V1NE JA1KXM R-01'],
    });
    expect(texts(s)).toEqual([
      '0:CQ 9V1NE OJ11',
      '2:K1ABC 9V1NE -15',
      '4:K1ABC 9V1NE RR73',
      // JA1KXM called again in slot 5 at -10 dB; the report follows the latest decode.
      '6:JA1KXM 9V1NE -10',
      '8:JA1KXM 9V1NE RR73',
      '10:CQ 9V1NE OJ11',
    ]);
    expect(s.logged().map((r) => r.call)).toEqual(['K1ABC', 'JA1KXM']);
    expect(s.st.queue).toEqual([]);
  });

  it('skips dupes from the same UTC day, band and mode unless dupes are worked', () => {
    const today = { band: '20m', mode: 'FT8' as const, day: '20261013', grid: null };
    const s = new Sim({ run: true });
    s.send({ type: 'setWorked', worked: [{ call: 'K1ABC', ...today }], nowMs: s.at(0) });
    s.send({ type: 'callCq', nowMs: s.at(0, 0.1) });
    s.run(0, 2, { 1: [callers[0]] });
    expect(texts(s).at(-1)).toBe('2:CQ 9V1NE OJ11');
    expect(s.st.queue).toMatchObject([{ call: 'K1ABC', dupe: true }]);

    const w = new Sim({ workDupes: true, run: true });
    w.send({ type: 'setWorked', worked: [{ call: 'K1ABC', ...today }], nowMs: w.at(0) });
    w.send({ type: 'callCq', nowMs: w.at(0, 0.1) });
    w.run(0, 2, { 1: [callers[0]] });
    expect(texts(w).at(-1)).toBe('2:K1ABC 9V1NE -15');
  });

  it('does not count a QSO on another band or day as a dupe', () => {
    const s = new Sim({ run: true });
    s.send({ type: 'setWorked', worked: [{ call: 'K1ABC', band: '40m', mode: 'FT8', day: '20261013', grid: null }, { call: 'K1ABC', band: '20m', mode: 'FT8', day: '20261012', grid: null }], nowMs: s.at(0) });
    s.send({ type: 'callCq', nowMs: s.at(0, 0.1) });
    s.run(0, 2, { 1: [callers[0]] });
    expect(texts(s).at(-1)).toBe('2:K1ABC 9V1NE -15');
  });

  it('repeats RR73 without Run when the caller repeats the R-report', () => {
    const s = new Sim();
    s.send({ type: 'callCq', nowMs: s.at(0, 0.1) });
    s.run(0, 8, { 1: ['9V1NE K1ABC FN42'], 3: ['9V1NE K1ABC R-12'], 5: ['9V1NE K1ABC R-12'], 7: ['9V1NE K1ABC 73'] });
    expect(texts(s).slice(-2)).toEqual(['4:K1ABC 9V1NE RR73', '6:K1ABC 9V1NE RR73']);
    expect(s.logged()).toHaveLength(1);
    expect(s.st).toMatchObject({ phase: 'idle', txEnabled: false });
  });

  it('stops repeating RR73 after the repeats to a caller who keeps sending the R-report, and keeps the QSO logged', () => {
    const s = new Sim();
    s.send({ type: 'callCq', nowMs: s.at(0, 0.1) });
    const r = '9V1NE K1ABC R-12';
    s.run(0, 14, { 1: ['9V1NE K1ABC FN42'], 3: [r], 5: [r], 7: [r], 9: [r], 11: [r], 13: [r] });
    expect(texts(s).filter((t) => t.endsWith('RR73'))).toEqual(['4:K1ABC 9V1NE RR73', '6:K1ABC 9V1NE RR73', '8:K1ABC 9V1NE RR73', '10:K1ABC 9V1NE RR73']);
    expect(s.logged()).toHaveLength(1);
    // The QSO is logged: no "not logged" notice when the repeats run out.
    expect(s.notices().map((n) => n.text)).toEqual([]);
    expect(s.st).toMatchObject({ phase: 'idle', txEnabled: false });
  });

  it('turns Tx off after the QSO without Run, as WSJT-X does after 73', () => {
    const s = new Sim();
    s.send({ type: 'callCq', nowMs: s.at(0, 0.1) });
    s.run(0, 8, { 1: ['9V1NE K1ABC FN42'], 3: ['9V1NE K1ABC R-12'], 5: ['9V1NE K1ABC 73'], 7: ['9V1NE JA1KXM PM95'] });
    expect(texts(s)).toEqual(['0:CQ 9V1NE OJ11', '2:K1ABC 9V1NE -10', '4:K1ABC 9V1NE RR73']);
    expect(s.logged()).toHaveLength(1);
    expect(s.st).toMatchObject({ phase: 'idle', txEnabled: false, partner: null });
  });

  it('makes a station worked in this run a dupe', () => {
    const s = new Sim({ run: true });
    s.send({ type: 'callCq', nowMs: s.at(0, 0.1) });
    s.run(0, 6, { 1: [callers[0]], 3: ['9V1NE K1ABC R-12'], 5: [callers[0]] });
    expect(texts(s).at(-1)).toBe('6:CQ 9V1NE OJ11');
  });

  it('drops a caller who goes quiet after 3 repeats, unlogged, and moves on', () => {
    const s = new Sim({ run: true });
    s.send({ type: 'callCq', nowMs: s.at(0, 0.1) });
    s.run(0, 10, { 1: callers.slice(0, 2) });
    expect(texts(s)).toEqual([
      '0:CQ 9V1NE OJ11',
      '2:K1ABC 9V1NE -15',
      '4:K1ABC 9V1NE -15',
      '6:K1ABC 9V1NE -15',
      '8:K1ABC 9V1NE -15',
      '10:CQ 9V1NE OJ11',
    ]);
    expect(s.notices().map((n) => n.kind)).toEqual(['dropped']);
    expect(s.logged()).toEqual([]);
  });

  it('works the next caller after a drop when one is still calling', () => {
    const s = new Sim({ run: true });
    s.send({ type: 'callCq', nowMs: s.at(0, 0.1) });
    s.run(0, 10, { 1: callers.slice(0, 2), 9: [callers[1]] });
    expect(texts(s).at(-1)).toBe('10:JA1KXM 9V1NE -05');
  });

  it('lets callers go stale after 4 slots', () => {
    const s = new Sim({ run: true });
    s.send({ type: 'callCq', nowMs: s.at(0, 0.1) });
    s.run(0, 1, { 1: callers.slice(0, 2) });
    expect(s.st.queue.map((c) => c.call)).toEqual(['JA1KXM']);
    s.run(2, 7, { 3: ['9V1NE K1ABC -12'] });
    expect(s.st.queue).toEqual([]);
  });

  it('adds callers from an early pass and decides only on the final pass', () => {
    const s = new Sim({ run: true });
    s.send({ type: 'callCq', nowMs: s.at(0, 0.1) });
    s.run(0, 0);
    const early = s.hear(1, [callers[0]], -1.2, 'early');
    expect(early.map((f) => f.type)).toEqual(['queueChanged']);
    expect(s.st.queue.map((c) => c.call)).toEqual(['K1ABC']);
    s.hear(1, [callers[0]]);
    s.run(2, 2);
    expect(texts(s).at(-1)).toBe('2:K1ABC 9V1NE -15');
  });

  it('ends the run cleanly with Stop after this QSO', () => {
    const s = new Sim({ run: true });
    s.send({ type: 'callCq', nowMs: s.at(0, 0.1) });
    s.run(0, 1, { 1: callers.slice(0, 2) });
    s.send({ type: 'stopAfterQso', on: true, nowMs: s.at(2, 3) });
    s.run(2, 6, { 3: ['9V1NE K1ABC R-12'] });
    expect(texts(s)).toEqual(['0:CQ 9V1NE OJ11', '2:K1ABC 9V1NE -15', '4:K1ABC 9V1NE RR73']);
    expect(s.logged()).toHaveLength(1);
    expect(s.st).toMatchObject({ txEnabled: false, phase: 'idle' });
  });

  it('turns Run off without ending the QSO in progress', () => {
    const s = new Sim({ run: true });
    s.send({ type: 'callCq', nowMs: s.at(0, 0.1) });
    s.run(0, 1, { 1: callers.slice(0, 2) });
    s.send({ type: 'configure', patch: { run: false }, nowMs: s.at(2, 3) });
    expect(s.st.queue).toEqual([]);
    s.run(2, 4, { 3: ['9V1NE K1ABC R-12'] });
    expect(texts(s).at(-1)).toBe('4:K1ABC 9V1NE RR73');
  });
});

describe('calling a station from CQ', () => {
  it('follows the answering path and never goes back to CQ while the station does not answer', () => {
    const s = new Sim();
    s.send({ type: 'callCq', nowMs: s.at(0, 0.1) });
    s.run(0, 0);
    s.call(1, 'CQ VK2LAW QF56');
    expect(s.st.phase).toBe('answering');
    s.run(2, 14);
    expect(texts(s)).toEqual(['0:CQ 9V1NE OJ11', '2:VK2LAW 9V1NE OJ11', '4:VK2LAW 9V1NE OJ11', '6:VK2LAW 9V1NE OJ11', '8:VK2LAW 9V1NE OJ11']);
    expect(s.st).toMatchObject({ phase: 'answering', paused: true, txEnabled: true, current: 1 });
    expect(s.notices().map((n) => n.kind)).toEqual(['no-reply']);
  });

  it('with Run, calls CQ again once that QSO is logged', () => {
    const s = new Sim({ run: true });
    s.send({ type: 'callCq', nowMs: s.at(0, 0.1) });
    s.run(0, 0);
    s.call(1, 'CQ VK2LAW QF56');
    s.run(2, 8, { 3: ['9V1NE VK2LAW -09'], 5: ['9V1NE VK2LAW RR73'] });
    expect(texts(s)).toEqual(['0:CQ 9V1NE OJ11', '2:VK2LAW 9V1NE OJ11', '4:VK2LAW 9V1NE R-10', '6:VK2LAW 9V1NE 73', '8:CQ 9V1NE OJ11']);
    expect(s.logged().map((r) => r.call)).toEqual(['VK2LAW']);
  });

  it('without Run, turns Tx off after 73', () => {
    const s = new Sim();
    s.send({ type: 'callCq', nowMs: s.at(0, 0.1) });
    s.run(0, 0);
    s.call(1, 'CQ VK2LAW QF56');
    s.run(2, 8, { 3: ['9V1NE VK2LAW -09'], 5: ['9V1NE VK2LAW RR73'] });
    expect(texts(s).at(-1)).toBe('6:VK2LAW 9V1NE 73');
    expect(s.st).toMatchObject({ phase: 'idle', txEnabled: false });
  });
});

describe('a lost station', () => {
  it('stops calling when the station sends a report, R-report, RR73 or 73 to someone else, and says so', () => {
    for (const msg of ['DV5CEL VK2LAW -05', 'DV5CEL VK2LAW R-05', 'DV5CEL VK2LAW RR73', 'DV5CEL VK2LAW 73']) {
      const s = new Sim({ tailEnd: false });
      s.call(1, 'CQ VK2LAW QF56');
      s.run(2, 10, { 3: [msg], 5: [msg], 7: ['CQ VK2LAW QF56'] });
      expect(texts(s), msg).toEqual(['2:VK2LAW 9V1NE OJ11']);
      expect(s.notices(), msg).toEqual([{ type: 'notice', kind: 'lost', text: 'VK2LAW answered DV5CEL' }]);
      expect(s.st, msg).toMatchObject({ phase: 'answering', paused: true, txEnabled: true });
    }
  });

  it('reports the loss once, with the station, the station it answered and the slot, for the Lost mark on its rows', () => {
    for (const hunt of [false, true]) {
      const s = new Sim();
      if (hunt) {
        s.send({ type: 'hunt', on: true, nowMs: s.at(0, 5) });
        s.run(0, 6, { 1: ['CQ VK2LAW QF56'], 3: ['DV5CEL VK2LAW -05'], 5: ['DV5CEL VK2LAW RR73'] });
      } else {
        s.call(1, 'CQ VK2LAW QF56');
        s.run(2, 6, { 3: ['DV5CEL VK2LAW -05'], 5: ['DV5CEL VK2LAW RR73'] });
      }
      expect(s.effects.filter((f) => f.type === 'lostTo'), `hunt ${hunt}`).toEqual([{ type: 'lostTo', call: 'VK2LAW', other: 'DV5CEL', slotStartMs: s.at(3) }]);
    }
  });

  it('keeps calling a station that calls CQ again or calls another station', () => {
    const s = new Sim({ tailEnd: false });
    s.call(1, 'CQ VK2LAW QF56');
    s.run(2, 6, { 3: ['CQ VK2LAW QF56'], 5: ['DV5CEL VK2LAW QF56'] });
    expect(texts(s)).toEqual(['2:VK2LAW 9V1NE OJ11', '4:VK2LAW 9V1NE OJ11', '6:VK2LAW 9V1NE OJ11']);
    expect(s.notices()).toEqual([]);
  });

  it('does not treat a station that has answered us as lost', () => {
    const s = new Sim();
    s.call(1, 'CQ VK2LAW QF56');
    s.run(2, 6, { 3: ['9V1NE VK2LAW -09'], 5: ['DV5CEL VK2LAW -03'] });
    expect(texts(s)).toEqual(['2:VK2LAW 9V1NE OJ11', '4:VK2LAW 9V1NE R-10', '6:VK2LAW 9V1NE R-10']);
    expect(s.notices()).toEqual([]);
  });
});

describe('tail-ending', () => {
  it('calls once more after their RR73 or 73 to the other station, and works them', () => {
    for (const end of ['RR73', '73']) {
      const s = new Sim();
      s.call(1, 'CQ VK2LAW QF56');
      s.run(2, 10, { 3: ['DV5CEL VK2LAW -05'], 5: [`DV5CEL VK2LAW ${end}`], 7: ['9V1NE VK2LAW -08'], 9: ['9V1NE VK2LAW RR73'] });
      expect(texts(s), end).toEqual(['2:VK2LAW 9V1NE OJ11', '6:VK2LAW 9V1NE OJ11', '8:VK2LAW 9V1NE R-10', '10:VK2LAW 9V1NE 73']);
      expect(s.logged().map((r) => r.call)).toEqual(['VK2LAW']);
      expect(s.notices()).toEqual([{ type: 'notice', kind: 'lost', text: 'VK2LAW answered DV5CEL' }]);
    }
  });

  it('never calls while they are in their QSO', () => {
    const s = new Sim();
    s.call(1, 'CQ VK2LAW QF56');
    s.run(2, 8, { 3: ['DV5CEL VK2LAW -05'], 5: ['DV5CEL VK2LAW -05'], 7: ['DV5CEL VK2LAW RR73'] });
    expect(texts(s)).toEqual(['2:VK2LAW 9V1NE OJ11', '8:VK2LAW 9V1NE OJ11']);
    // Tx on by hand does not call them either.
    const t = new Sim();
    t.call(1, 'CQ VK2LAW QF56');
    t.run(2, 3, { 3: ['DV5CEL VK2LAW -05'] });
    t.send({ type: 'enableTx', on: true, nowMs: t.at(4, 0.4) });
    t.run(4, 4);
    expect(texts(t)).toEqual(['2:VK2LAW 9V1NE OJ11']);
  });

  it('gives up after one unanswered call', () => {
    const s = new Sim();
    s.call(1, 'CQ VK2LAW QF56');
    s.run(2, 14, { 3: ['DV5CEL VK2LAW -05'], 5: ['DV5CEL VK2LAW RR73'], 7: ['CQ VK2LAW QF56'], 9: ['CQ VK2LAW QF56'] });
    expect(texts(s)).toEqual(['2:VK2LAW 9V1NE OJ11', '6:VK2LAW 9V1NE OJ11']);
    expect(s.notices().at(-1)).toEqual({ type: 'notice', kind: 'no-reply', text: 'No reply from VK2LAW' });
    expect(s.st).toMatchObject({ paused: true, txEnabled: true, lost: null });
  });

  it('calls in the slot after theirs, in the opposite parity, late or in the next slot of that parity', () => {
    // An even station: we transmit in odd slots.
    for (const [delay, slot, offset, tooLate] of [
      [0.1, 7, 0.5, null],
      [1.0, 7, 1.2, null],
      [1.9, 7, 2.1, null],
      [4.4, 9, 0.5, 7],
    ] as const) {
      const s = new Sim();
      s.call(2, 'CQ VK2LAW QF56');
      s.run(3, 5, { 4: ['DV5CEL VK2LAW -05'] });
      s.hear(6, ['DV5CEL VK2LAW RR73'], delay);
      expect(s.st.parity).toBe('odd');
      expect(s.st.next, String(delay)).toMatchObject({ tx: 1, slotStartMs: s.at(slot), offsetS: offset, tooLateFor: tooLate === null ? null : s.at(tooLate) });
    }
  });

  it('stops waiting after 8 slots of their QSO', () => {
    const s = new Sim();
    s.call(1, 'CQ VK2LAW QF56');
    const heard: Record<number, string[]> = {};
    for (let i = 3; i <= 15; i += 2) heard[i] = ['DV5CEL VK2LAW -05'];
    s.run(2, 11, heard);
    expect(s.st.lost?.state).toBe('watching');
    s.run(12, 16, heard);
    expect(texts(s)).toEqual(['2:VK2LAW 9V1NE OJ11']);
    expect(s.notices().at(-1)).toMatchObject({ kind: 'lost', text: 'VK2LAW is still working DV5CEL' });
    expect(s.st).toMatchObject({ paused: true, lost: null });
  });
});

describe('Hunt', () => {
  const cqs = [decode('CQ JA1KXM PM95', -5, 900), decode('CQ K1ABC FN42', -15, 600), decode('CQ VK3QRP QF22', -20, 1200)];
  // Stronger, and skipped: a directed CQ, a CQ with a modifier and a station in a QSO.
  const skipped = [decode('CQ DX ZL1TQK RF70', 3, 1500), decode('CQ POTA W1AW FN31', 2, 1700), decode('ZL2AA ZL1BB -10', 4, 1800)];
  const worked = (call: string, over: Partial<Worked> = {}): Worked => ({ call, band: '20m', mode: 'FT8', day: '20261001', grid: null, ...over });

  function pick(order: HuntOrder, w: Worked[] = []) {
    const s = new Sim({ huntOrder: order });
    s.send({ type: 'setWorked', worked: w, nowMs: s.at(0) });
    s.send({ type: 'hunt', on: true, nowMs: s.at(0, 5) });
    s.hear(1, [...skipped, ...cqs]);
    return s.st.partner?.call;
  }

  it('picks by the chosen order', () => {
    expect(pick('strongest')).toBe('JA1KXM');
    // From OJ11: FN42 about 15000 km, QF22 about 6000 km, PM95 about 5300 km.
    expect(pick('farthest')).toBe('K1ABC');
    expect(pick('new', [worked('JA1KXM', { band: '40m' }), worked('K1ABC', { mode: 'FT4' })])).toBe('VK3QRP');
    // Not worked on this band and mode, strongest first.
    expect(pick('unworked', [worked('JA1KXM'), worked('K1ABC', { band: '40m' })])).toBe('K1ABC');
    expect(pick('strongest', [worked('JA1KXM'), worked('K1ABC', { band: '40m' })])).toBe('JA1KXM');
  });

  it('picks the newest CQ: the station that started calling most recently', () => {
    const s = new Sim({ huntOrder: 'newest' });
    s.hear(1, cqs.slice(0, 2));
    s.hear(3, cqs);
    // Started 0.3 s into slot 4: the CQs of slot 3 can still be answered in it.
    s.send({ type: 'hunt', on: true, nowMs: s.at(4, 0.3) });
    expect(s.st.partner?.call).toBe('VK3QRP');
    expect(s.st.next).toMatchObject({ tx: 1, slotStartMs: s.at(4), offsetS: 0.5 });
  });

  it('skips dupes, and picks nothing when only skipped stations call', () => {
    const s = new Sim({ huntOrder: 'strongest' });
    s.send({ type: 'setWorked', worked: [worked('JA1KXM', { day: '20261013' })], nowMs: s.at(0) });
    s.send({ type: 'hunt', on: true, nowMs: s.at(0, 5) });
    s.hear(1, [...skipped, cqs[0]]);
    expect(s.st.partner).toBeNull();
    s.hear(3, [...skipped, ...cqs]);
    expect(s.st.partner?.call).toBe('K1ABC');
  });

  it('answers in the slot after the CQ, completes and logs the QSO, then picks the next', () => {
    const s = new Sim();
    s.send({ type: 'hunt', on: true, nowMs: s.at(0, 5) });
    s.run(0, 10, { 1: cqs.slice(0, 2), 3: ['9V1NE JA1KXM -09', cqs[1]], 5: ['9V1NE JA1KXM RR73', cqs[1]], 7: [cqs[1]], 9: ['9V1NE K1ABC -11'] });
    expect(texts(s)).toEqual(['2:JA1KXM 9V1NE OJ11', '4:JA1KXM 9V1NE R-10', '6:JA1KXM 9V1NE 73', '8:K1ABC 9V1NE OJ11', '10:K1ABC 9V1NE R-10']);
    expect(s.logged().map((r) => r.call)).toEqual(['JA1KXM']);
    expect(s.st).toMatchObject({ hunt: true, huntQsos: 1, txEnabled: true, phase: 'answering' });
  });

  it('leaves a station that ignored it alone for 10 min', () => {
    const s = new Sim();
    s.send({ type: 'hunt', on: true, nowMs: s.at(0, 5) });
    const heard: Record<number, Decode[]> = {};
    for (let i = 1; i <= 51; i += 2) heard[i] = cqs.slice(0, 2);
    s.run(0, 18, heard);
    expect(texts(s)).toEqual([2, 4, 6, 8].map((i) => `${i}:JA1KXM 9V1NE OJ11`).concat([10, 12, 14, 16].map((i) => `${i}:K1ABC 9V1NE OJ11`)));
    expect(s.notices().map((n) => n.text)).toEqual(['No reply from JA1KXM', 'No reply from K1ABC']);
    // JA1KXM was given up at 13:16:30.1; Hunt calls him again 10 min later.
    expect(s.st.ignored.map((i) => i.call)).toEqual(['JA1KXM', 'K1ABC']);
    s.run(19, 50, heard);
    expect(texts(s).slice(8)).toEqual(['50:JA1KXM 9V1NE OJ11']);
    expect(s.at(50, 0.1) - s.at(10, 0.1)).toBe(IGNORE_MS);
  });

  it('moves on to the next CQ at once from a lost station, with tail-ending on or off', () => {
    for (const tailEnd of [true, false]) {
      const s = new Sim({ tailEnd });
      s.send({ type: 'hunt', on: true, nowMs: s.at(0, 5) });
      // JA1KXM answers DV5CEL in slot 3; K1ABC's CQ in the same slot is called in slot 4.
      s.run(0, 8, { 1: [cqs[0]], 3: ['DV5CEL JA1KXM -05', cqs[1]], 5: ['DV5CEL JA1KXM RR73', '9V1NE K1ABC -11'], 7: ['CQ JA1KXM PM95'] });
      expect(texts(s).slice(0, 2), `tail-end ${tailEnd}`).toEqual(['2:JA1KXM 9V1NE OJ11', '4:K1ABC 9V1NE OJ11']);
      expect(s.notices().map((n) => n.text)).toContain('JA1KXM answered DV5CEL');
      // No tail-end call to JA1KXM after its RR73, and it is free to be called again later.
      expect(texts(s).filter((t) => t.includes('JA1KXM'))).toEqual(['2:JA1KXM 9V1NE OJ11']);
      expect(s.st.ignored).toEqual([]);
    }
  });

  it('leaves alone for 10 min a station that answers another station twice while it calls', () => {
    const s = new Sim();
    s.send({ type: 'hunt', on: true, nowMs: s.at(0, 5) });
    const cq = cqs[0];
    s.run(0, 10, { 1: [cq], 3: ['DV5CEL JA1KXM -05'], 5: [cq], 7: ['W1AW JA1KXM -07'], 9: [cq] });
    // Called after each CQ in slots 1 and 5; after the second loss its CQ in slot 9 goes unanswered.
    expect(texts(s)).toEqual(['2:JA1KXM 9V1NE OJ11', '6:JA1KXM 9V1NE OJ11']);
    expect(s.st.ignored.map((i) => i.call)).toEqual(['JA1KXM']);
    expect(s.notices().map((n) => n.text)).toEqual(['JA1KXM answered DV5CEL', 'JA1KXM answered W1AW']);
  });

  it('and CQ stop each other', () => {
    const s = new Sim();
    s.send({ type: 'callCq', nowMs: s.at(0, 0.1) });
    const fx = s.send({ type: 'hunt', on: true, nowMs: s.at(0, 1) });
    expect(fx).toContainEqual({ type: 'cancelTx', stopPlaying: false });
    expect(s.st).toMatchObject({ phase: 'idle', hunt: true, txEnabled: true, next: null });
    s.send({ type: 'callCq', nowMs: s.at(0, 2) });
    expect(s.st).toMatchObject({ phase: 'cq', hunt: false });
  });

  it('lets a QSO under way finish when it stops, then turns Tx off', () => {
    const s = new Sim();
    s.send({ type: 'hunt', on: true, nowMs: s.at(0, 5) });
    s.run(0, 3, { 1: [cqs[0]], 3: ['9V1NE JA1KXM -09'] });
    s.send({ type: 'hunt', on: false, nowMs: s.at(4, 0.2) });
    s.run(4, 8, { 5: ['9V1NE JA1KXM RR73', cqs[1]], 7: [cqs[1]] });
    expect(texts(s)).toEqual(['2:JA1KXM 9V1NE OJ11', '4:JA1KXM 9V1NE R-10', '6:JA1KXM 9V1NE 73']);
    expect(s.st).toMatchObject({ hunt: false, txEnabled: false, phase: 'idle' });
    // Off with nobody in a QSO: Tx goes off at once.
    const t = new Sim();
    t.send({ type: 'hunt', on: true, nowMs: t.at(0, 5) });
    t.send({ type: 'hunt', on: false, nowMs: t.at(0, 6) });
    expect(t.st).toMatchObject({ hunt: false, txEnabled: false });
  });

  it('moves on after the calls the operator set, and keeps the usual repeats once answered', () => {
    const calls = (huntCalls?: number) => {
      const s = new Sim({ huntCalls });
      s.send({ type: 'hunt', on: true, nowMs: s.at(0, 5) });
      s.run(0, 12, { 1: ['CQ JA1KXM PM95'], 3: ['CQ K1ABC FN42'], 5: ['CQ K1ABC FN42'], 9: ['CQ K1ABC FN42'] });
      return texts(s);
    };
    // 4 calls by default: the first and 3 repeats.
    expect(calls().slice(0, 5)).toEqual(['2:JA1KXM 9V1NE OJ11', '4:JA1KXM 9V1NE OJ11', '6:JA1KXM 9V1NE OJ11', '8:JA1KXM 9V1NE OJ11', '10:K1ABC 9V1NE OJ11']);
    expect(calls(1).slice(0, 2)).toEqual(['2:JA1KXM 9V1NE OJ11', '4:K1ABC 9V1NE OJ11']);
    expect(calls(2).slice(0, 3)).toEqual(['2:JA1KXM 9V1NE OJ11', '4:JA1KXM 9V1NE OJ11', '6:K1ABC 9V1NE OJ11']);

    const s = new Sim({ huntCalls: 1 });
    s.send({ type: 'hunt', on: true, nowMs: s.at(0, 5) });
    s.run(0, 10, { 1: ['CQ JA1KXM PM95'], 3: ['9V1NE JA1KXM -09'] });
    expect(texts(s)).toEqual(['2:JA1KXM 9V1NE OJ11', '4:JA1KXM 9V1NE R-10', '6:JA1KXM 9V1NE R-10', '8:JA1KXM 9V1NE R-10', '10:JA1KXM 9V1NE R-10']);
  });

  it('stops with Halt and the watchdog', () => {
    const s = new Sim();
    s.send({ type: 'hunt', on: true, nowMs: s.at(0, 5) });
    s.send({ type: 'halt', nowMs: s.at(0, 6) });
    expect(s.st).toMatchObject({ hunt: false, txEnabled: false });
    const w = new Sim({ watchdogMs: 60_000 });
    w.send({ type: 'hunt', on: true, nowMs: w.at(0, 5) });
    w.send({ type: 'tick', nowMs: w.at(4, 5) });
    expect(w.st).toMatchObject({ hunt: false, txEnabled: false });
  });
});

describe('our transmission on air', () => {
  /** Calling CQ in `cqParity`, with the CQ of slot `i` on air since 0.5 s. */
  function cqOnAir(i: number, over: ConstructorParameters<typeof Sim>[0] = {}) {
    const s = new Sim({ cqParity: i % 2 === 0 ? 'even' : 'odd', ...over });
    s.send({ type: 'callCq', nowMs: s.at(i - 2, 1) });
    s.play(i - 2);
    s.hear(i - 1, []);
    s.send({ type: 'txStarted', slotStartMs: s.at(i), text: 'CQ 9V1NE OJ11', nowMs: s.at(i, 0.5) });
    s.pending = null;
    return s;
  }

  it('gives way to a station called by hand: the call goes out in the same slot', () => {
    for (const i of [2, 3]) {
      const s = cqOnAir(i);
      const fx = s.call(i - 1, 'CQ JA1KXM PM95', 0.6);
      expect(fx.filter((f) => f.type === 'cancelTx').at(-1), String(i)).toEqual({ type: 'cancelTx', stopPlaying: true });
      expect(fx.at(-1), String(i)).toMatchObject({ type: 'scheduleTx', tx: 1, text: 'JA1KXM 9V1NE OJ11', slotStartMs: s.at(i), startOffsetS: 0.8 });
      expect(s.st.onAir).toBeNull();
    }
  });

  it('plays out after 1.5 s in FT8 and 0.5 s in FT4, where the switch would spoil the new message', () => {
    const s = cqOnAir(2);
    const fx = s.call(1, 'CQ JA1KXM PM95', 1.81);
    expect(fx.filter((f) => f.type === 'cancelTx' && f.stopPlaying)).toEqual([]);
    expect(s.st.next).toMatchObject({ tx: 1, slotStartMs: s.at(4), tooLateFor: s.at(2) });
    expect(s.st.onAir).toMatchObject({ text: 'CQ 9V1NE OJ11' });
    const t = cqOnAir(2);
    t.call(1, 'CQ JA1KXM PM95', 1.8);
    expect(t.st.next).toMatchObject({ slotStartMs: t.at(2), offsetS: 2 });

    for (const [after, slot] of [
      [0.8, 2],
      [0.81, 4],
    ] as const) {
      const f = cqOnAir(2, { mode: 'FT4' });
      f.call(1, 'CQ JA1KXM PM95', after);
      expect(f.st.next, String(after)).toMatchObject({ slotStartMs: f.at(slot) });
    }
  });

  it('plays out RR73, RRR, 73 and the same message, and the new one goes a cycle later', () => {
    const s = new Sim();
    s.call(1, 'CQ JA1KXM PM95');
    s.run(2, 3, { 3: ['9V1NE JA1KXM R-09'] });
    // RR73 on air in slot 4; the operator calls another station heard in slot 3.
    s.send({ type: 'txStarted', slotStartMs: s.at(4), text: 'JA1KXM 9V1NE RR73', nowMs: s.at(4, 0.5) });
    const fx = s.call(3, 'CQ K1ABC FN42', 0.6);
    expect(fx.filter((f) => f.type === 'cancelTx' && f.stopPlaying)).toEqual([]);
    expect(s.st.next).toMatchObject({ tx: 1, slotStartMs: s.at(6), tooLateFor: s.at(4) });

    const t = cqOnAir(2);
    t.send({ type: 'callCq', nowMs: t.at(2, 0.8) });
    expect(t.st.next).toMatchObject({ tx: 6, slotStartMs: t.at(4) });
    expect(t.st.onAir).toMatchObject({ text: 'CQ 9V1NE OJ11' });
  });
});

describe('late start', () => {
  it('starts up to 4 s late in FT8 and moves to the next slot of our parity after that', () => {
    const s = new Sim();
    for (const [after, slot, offset, tooLate] of [
      [0.1, 2, 0.5, null],
      [0.3, 2, 0.5, null],
      [1.0, 2, 1.2, null],
      [1.8, 2, 2.0, null],
      [4.3, 2, 4.5, null],
      [4.31, 4, 0.5, 2],
    ] as const) {
      s.call(1, 'CQ JA1KXM PM95', after);
      expect(s.st.next, String(after)).toMatchObject({ slotStartMs: s.at(slot), offsetS: offset, tooLateFor: tooLate === null ? null : s.at(tooLate) });
    }
    expect(LATE_S.FT8).toBe(4);
  });

  it('allows 1.25 s in FT4', () => {
    const s = new Sim({ mode: 'FT4' });
    s.call(1, 'CQ JA1KXM PM95', 1.55);
    expect(s.st.next).toMatchObject({ slotStartMs: s.at(2), offsetS: 1.75 });
    s.call(1, 'CQ JA1KXM PM95', 1.56);
    expect(s.st.next).toMatchObject({ slotStartMs: s.at(4), offsetS: 0.5, tooLateFor: s.at(2) });
  });

  it('replans a transmission the audio layer missed', () => {
    const s = new Sim();
    s.call(1, 'CQ JA1KXM PM95');
    s.send({ type: 'txMissed', slotStartMs: s.at(2), nowMs: s.at(2, 2.1) });
    expect(s.st.next).toMatchObject({ slotStartMs: s.at(4), scheduled: true });
  });
});

describe('later decoding passes', () => {
  it('act on a reply only they found, starting late in the slot while it can still take it', () => {
    const s = new Sim();
    s.call(1, 'CQ JA1KXM PM95');
    // Nothing heard in slot 3 on the final pass: Tx1 again for slot 4.
    s.run(2, 3);
    expect(s.st).toMatchObject({ retries: 1, next: { tx: 1, slotStartMs: s.at(4), offsetS: 0.5 } });
    const fx = s.hear(3, ['9V1NE JA1KXM -09'], 0.9, 'late');
    expect(fx.map((f) => f.type)).toEqual(['cancelTx', 'scheduleTx']);
    expect(fx[0]).toEqual({ type: 'cancelTx', stopPlaying: false });
    expect(s.st).toMatchObject({ retries: 0, next: { tx: 3, slotStartMs: s.at(4), offsetS: 1.1, tooLateFor: null } });
    s.run(4, 5, { 5: ['9V1NE JA1KXM RR73'] });
    expect(texts(s)).toEqual(['2:JA1KXM 9V1NE OJ11', '4:JA1KXM 9V1NE R-10']);
    expect(s.sent.at(-1)?.offsetS).toBe(1.1);
    expect(s.logged()).toHaveLength(1);
  });

  it('plan a cycle later when the reply comes too late for the slot', () => {
    // 4.4 s into slot 4 the start would be 4.6 s, past the 4 s late start.
    const a = new Sim();
    a.call(1, 'CQ JA1KXM PM95');
    a.run(2, 3);
    a.hear(3, ['9V1NE JA1KXM -09'], 4.4, 'late');
    expect(a.st.next).toMatchObject({ tx: 3, slotStartMs: a.at(6), offsetS: 0.5, tooLateFor: a.at(4) });
  });

  it('replace a repeat on air with the answer they found', () => {
    const b = new Sim();
    b.call(1, 'CQ JA1KXM PM95');
    b.run(2, 3);
    b.send({ type: 'txStarted', slotStartMs: b.at(4), text: 'JA1KXM 9V1NE OJ11', nowMs: b.at(4, 0.5) });
    const fx = b.hear(3, ['9V1NE JA1KXM -09'], 0.9, 'late');
    expect(fx.filter((f) => f.type === 'cancelTx')).toEqual([{ type: 'cancelTx', stopPlaying: true }]);
    expect(fx).toContainEqual(expect.objectContaining({ type: 'scheduleTx', tx: 3, slotStartMs: b.at(4), startOffsetS: 1.1 }));
    expect(b.st.onAir).toBeNull();
    // The Tx1 cut short is not a call sent: the audio layer's end report changes nothing.
    b.send({ type: 'txEnded', slotStartMs: b.at(4), text: 'JA1KXM 9V1NE OJ11', complete: false, nowMs: b.at(4, 1) });
    expect(b.st.next).toMatchObject({ tx: 3, slotStartMs: b.at(4), scheduled: true });
  });

  it('add a caller only they found to the queue, answered at once when nobody else called', () => {
    const s = new Sim({ run: true });
    s.send({ type: 'callCq', nowMs: s.at(0, 0.1) });
    s.run(0, 1);
    expect(s.st.next).toMatchObject({ tx: 6, slotStartMs: s.at(2) });
    s.hear(1, [decode('9V1NE K1ABC FN42', -22, 600)], 0.6, 'late');
    expect(s.st.partner?.call).toBe('K1ABC');
    expect(s.st.next).toMatchObject({ tx: 2, slotStartMs: s.at(2), offsetS: 0.8 });
    // In a QSO, a caller found by a later pass waits in the queue.
    s.run(2, 2);
    s.hear(3, ['9V1NE K1ABC R-12']);
    const fx = s.hear(3, [decode('9V1NE JA1KXM PM95', -20, 900)], 0.7, 'late');
    expect(fx.map((f) => f.type)).toEqual(['queueChanged']);
    expect(s.st.queue.map((c) => c.call)).toEqual(['JA1KXM']);
    expect(s.st).toMatchObject({ partner: { call: 'K1ABC' }, next: { tx: 4, slotStartMs: s.at(4), offsetS: 0.5 } });
  });

  it('let Hunt answer a CQ only they found', () => {
    const s = new Sim();
    s.send({ type: 'hunt', on: true, nowMs: s.at(0, 5) });
    s.hear(1, []);
    expect(s.st.partner).toBeNull();
    s.hear(1, [decode('CQ JA1KXM PM95', -21, 900)], 0.5, 'late');
    expect(s.st.partner?.call).toBe('JA1KXM');
    expect(s.st.next).toMatchObject({ tx: 1, slotStartMs: s.at(2), offsetS: 0.7 });
  });

  it('act once on a decode an earlier pass brought, and repeat nothing for what they lack', () => {
    const s = new Sim();
    s.call(1, 'CQ JA1KXM PM95');
    s.run(2, 2);
    s.hear(3, ['9V1NE JA1KXM -09']);
    const planned = s.st.next;
    expect(planned).toMatchObject({ tx: 3, slotStartMs: s.at(4), offsetS: 0.5 });
    expect(s.hear(3, ['9V1NE JA1KXM -09'], 0.8, 'late')).toEqual([]);
    expect(s.st.next).toEqual(planned);
    // A later pass of a slot decided before the last one counts for nothing.
    expect(s.hear(1, ['9V1NE JA1KXM R-03'], 0.9, 'late')).toEqual([]);

    // Nothing from the partner in a later pass: no second repeat, no retry counted.
    const t = new Sim();
    t.call(1, 'CQ JA1KXM PM95');
    t.run(2, 3);
    expect(t.hear(3, ['CQ K1ABC FN42'], 0.8, 'late')).toEqual([]);
    expect(t.st.retries).toBe(1);
    expect(t.st.next).toMatchObject({ tx: 1, slotStartMs: t.at(4), offsetS: 0.5 });
  });
});

describe('parity', () => {
  it('transmits in the parity opposite the station answered', () => {
    const odd = new Sim();
    odd.call(1, 'CQ JA1KXM PM95');
    expect(odd.st.parity).toBe('even');
    const even = new Sim();
    even.call(2, 'CQ JA1KXM PM95');
    expect(even.st.parity).toBe('odd');
    even.run(3, 3);
    expect(even.sent.map((t) => t.slot)).toEqual([3]);
  });

  it('calls CQ in the chosen parity and ignores replies in our own', () => {
    const s = new Sim({ cqParity: 'odd' });
    s.send({ type: 'callCq', nowMs: s.at(0, 0.1) });
    expect(s.st.next?.slotStartMs).toBe(s.at(1));
    s.run(1, 1);
    s.hear(2, ['9V1NE K1ABC FN42']);
    s.run(3, 3);
    expect(texts(s)).toEqual(['1:CQ 9V1NE OJ11', '3:K1ABC 9V1NE -10']);
    // A reply decoded in our own parity is not acted on.
    const t = new Sim({ cqParity: 'odd' });
    t.send({ type: 'callCq', nowMs: t.at(0, 0.1) });
    t.run(1, 1);
    t.hear(1, ['9V1NE K1ABC FN42']);
    expect(t.st.partner).toBeNull();
  });

  it('only ever transmits in one parity during a QSO', () => {
    const s = new Sim();
    s.call(1, 'CQ JA1KXM PM95');
    s.run(2, 9, { 3: ['9V1NE JA1KXM -09'] });
    expect(s.sent.every((t) => t.slot % 2 === 0)).toBe(true);
  });
});

describe('records', () => {
  it('records FT4, the dial and our audio frequency, and the call and grid used on air', () => {
    const s = new Sim({ mode: 'FT4', myCall: 'VK3/9V1NE', myGrid: 'QF22lb', txHz: 1180, dialHz: 14080000 });
    s.call(1, 'CQ JA1KXM PM95');
    s.run(2, 6, { 3: ['VK3/9V1NE JA1KXM -09'], 5: ['VK3/9V1NE JA1KXM RR73'] });
    expect(s.logged()[0]).toMatchObject({ mode: 'FT4', dialHz: 14_080_000, audioHz: 1180, stationCallsign: 'VK3/9V1NE', myGridsquare: 'QF22lb' });
  });
});

describe('watchdog', () => {
  it('stops Tx 6 min after the last action', () => {
    const s = new Sim();
    s.send({ type: 'callCq', nowMs: s.at(0, 0.1) });
    s.run(0, 22);
    s.send({ type: 'tick', nowMs: s.at(24, 0.05) });
    expect(s.st.txEnabled).toBe(true);
    s.send({ type: 'tick', nowMs: s.at(24, 0.1) });
    expect(s.st).toMatchObject({ txEnabled: false, hunt: false });
    expect(s.notices().at(-1)).toMatchObject({ kind: 'watchdog', text: 'Watchdog stopped Tx after 6 min' });
    expect(s.effects.at(-2)).toEqual({ type: 'cancelTx', stopPlaying: true });
  });

  it('resets on a touch', () => {
    const s = new Sim();
    s.send({ type: 'callCq', nowMs: s.at(0, 0.1) });
    s.send({ type: 'touch', nowMs: s.at(20) });
    s.send({ type: 'tick', nowMs: s.at(24, 0.2) });
    expect(s.st.txEnabled).toBe(true);
    s.send({ type: 'tick', nowMs: s.at(44) });
    expect(s.st.txEnabled).toBe(false);
  });

  it('counts from the last action while the QSO moves on, unless Responses refresh watchdog is on', () => {
    for (const refresh of [false, true]) {
      const s = new Sim({ watchdogRefresh: refresh });
      s.send({ type: 'callCq', nowMs: s.at(0, 0.1) });
      s.run(0, 20);
      s.run(21, 22, { 21: ['9V1NE K1ABC FN42'] });
      expect(s.st.watchdogFromMs, String(refresh)).toBe(refresh ? s.at(22, 0.5) : s.at(0, 0.1));
    }
  });

  it('lets a QSO under way finish, logs it, then turns Tx off', () => {
    const s = new Sim({ watchdogMs: 30_000 });
    s.call(1, 'CQ JA1KXM PM95');
    s.run(2, 3, { 3: ['9V1NE JA1KXM -09'] });
    s.send({ type: 'tick', nowMs: s.at(4, 1) });
    expect(s.st).toMatchObject({ txEnabled: true, watchdogEnding: true });
    expect(s.notices().at(-1)).toMatchObject({ kind: 'watchdog', text: 'Watchdog ends Tx after this QSO' });
    s.run(4, 6, { 5: ['9V1NE JA1KXM RR73'] });
    expect(texts(s)).toEqual(['2:JA1KXM 9V1NE OJ11', '4:JA1KXM 9V1NE R-10', '6:JA1KXM 9V1NE 73']);
    expect(s.logged()).toHaveLength(1);
    expect(s.st).toMatchObject({ txEnabled: false, watchdogEnding: false, phase: 'idle' });
    expect(s.notices().at(-1)?.text).toBe('Watchdog stopped Tx after 0.5 min');
  });

  it('starts nothing after the QSO it let finish: no next caller, CQ or Hunt pick', () => {
    const s = new Sim({ run: true });
    s.send({ type: 'callCq', nowMs: s.at(0, 0.1) });
    s.run(0, 22, { 21: ['9V1NE K1ABC FN42'] });
    s.send({ type: 'tick', nowMs: s.at(24, 0.2) });
    expect(s.st.watchdogEnding).toBe(true);
    s.run(23, 28, { 23: ['9V1NE K1ABC R-05'], 25: ['9V1NE W1AW FN31'] });
    expect(texts(s).slice(-2)).toEqual(['22:K1ABC 9V1NE -10', '24:K1ABC 9V1NE RR73']);
    expect(s.logged()).toHaveLength(1);
    expect(s.st).toMatchObject({ txEnabled: false, hunt: false });

    const h = new Sim({ watchdogMs: 60_000 });
    h.send({ type: 'hunt', on: true, nowMs: h.at(0, 5) });
    h.run(0, 2, { 1: ['CQ JA1KXM PM95'] });
    h.run(3, 3, { 3: ['9V1NE JA1KXM -09'] });
    h.send({ type: 'tick', nowMs: h.at(4, 6) });
    h.run(4, 8, { 5: ['9V1NE JA1KXM RR73'], 7: ['CQ K1ABC FN42'] });
    expect(texts(h)).toEqual(['2:JA1KXM 9V1NE OJ11', '4:JA1KXM 9V1NE R-10', '6:JA1KXM 9V1NE 73']);
    expect(h.st).toMatchObject({ txEnabled: false, hunt: false, partner: null });
  });

  it('stops at once with no reply yet, or when the QSO it let finish gives up', () => {
    const s = new Sim({ watchdogMs: 60_000 });
    s.call(1, 'CQ JA1KXM PM95');
    s.run(2, 5);
    s.send({ type: 'tick', nowMs: s.at(6, 0.3) });
    expect(s.st).toMatchObject({ txEnabled: false, watchdogEnding: false });
    expect(s.notices().at(-1)?.text).toBe('Watchdog stopped Tx after 1 min');

    const g = new Sim({ watchdogMs: 30_000 });
    g.call(1, 'CQ JA1KXM PM95');
    g.run(2, 3, { 3: ['9V1NE JA1KXM -09'] });
    g.send({ type: 'tick', nowMs: g.at(4, 1) });
    // No reply to the R-report: it repeats to the retry limit, then the call pauses.
    g.run(4, 12);
    expect(g.st.paused).toBe(true);
    g.send({ type: 'tick', nowMs: g.at(13, 1) });
    expect(g.st).toMatchObject({ txEnabled: false, watchdogEnding: false });
    expect(g.notices().at(-1)?.text).toBe('Watchdog stopped Tx after 0.5 min');
  });

  it('a touch while the last QSO finishes restarts the count, and CQ carries on after it', () => {
    const s = new Sim({ run: true });
    s.send({ type: 'callCq', nowMs: s.at(0, 0.1) });
    s.run(0, 22, { 21: ['9V1NE K1ABC FN42'] });
    s.send({ type: 'tick', nowMs: s.at(24, 0.2) });
    s.send({ type: 'touch', nowMs: s.at(24, 0.3) });
    expect(s.st).toMatchObject({ watchdogEnding: false, watchdogFromMs: s.at(24, 0.3) });
    s.run(23, 26, { 23: ['9V1NE K1ABC R-05'] });
    expect(texts(s).slice(-2)).toEqual(['24:K1ABC 9V1NE RR73', '26:CQ 9V1NE OJ11']);
    expect(s.st.txEnabled).toBe(true);
  });

  it('keeps Stop after QSO set while the last QSO finishes', () => {
    const s = new Sim({ run: true });
    s.send({ type: 'callCq', nowMs: s.at(0, 0.1) });
    s.run(0, 22, { 21: ['9V1NE K1ABC FN42'] });
    s.send({ type: 'tick', nowMs: s.at(24, 0.2) });
    s.send({ type: 'stopAfterQso', on: true, nowMs: s.at(24, 0.3) });
    expect(s.st).toMatchObject({ stopAfter: true, watchdogEnding: false });
    s.run(23, 26, { 23: ['9V1NE K1ABC R-05'] });
    expect(texts(s).at(-1)).toBe('24:K1ABC 9V1NE RR73');
    expect(s.st.txEnabled).toBe(false);
    expect(s.notices().at(-1)?.text).toBe('Watchdog ends Tx after this QSO');
  });

  it('takes any limit the operator sets', () => {
    for (const [ms, text] of [
      [30_000, '0.5 min'],
      [90_000, '1.5 min'],
      [45 * 60_000, '45 min'],
    ] as const) {
      const s = new Sim({ watchdogMs: ms });
      s.send({ type: 'callCq', nowMs: s.at(0, 0.1) });
      s.send({ type: 'tick', nowMs: s.at(0, 0.1) + ms - 1 });
      expect(s.st.txEnabled, text).toBe(true);
      s.send({ type: 'tick', nowMs: s.at(0, 0.1) + ms });
      expect(s.st.txEnabled, text).toBe(false);
      expect(s.notices().at(-1)?.text).toBe(`Watchdog stopped Tx after ${text}`);
    }
  });

  it('never stops Tx when off', () => {
    const s = new Sim({ watchdogMs: 0 });
    s.send({ type: 'callCq', nowMs: s.at(0, 0.1) });
    s.send({ type: 'tick', nowMs: s.at(1000) });
    expect(s.st.txEnabled).toBe(true);
    expect(s.notices()).toEqual([]);
  });

  it('has a configurable limit', () => {
    const s = new Sim({ watchdogMs: 60_000 });
    s.send({ type: 'callCq', nowMs: s.at(0, 0.1) });
    s.send({ type: 'tick', nowMs: s.at(4, 0.1) });
    expect(s.st.txEnabled).toBe(false);
    expect(s.notices().at(-1)?.text).toContain('1 min');
  });
});

describe('safety', () => {
  it('Halt stops at once, disables Tx and Hunt, and keeps the QSO', () => {
    const s = new Sim({ run: true });
    s.send({ type: 'callCq', nowMs: s.at(0, 0.1) });
    s.run(0, 1, { 1: ['9V1NE K1ABC FN42'] });
    s.play(2, 3.2);
    expect(s.effects.filter((f) => f.type === 'cancelTx').at(-1)).toEqual({ type: 'cancelTx', stopPlaying: true });
    expect(s.st).toMatchObject({ txEnabled: false, hunt: false, phase: 'cq' });
    expect(s.st.partner?.call).toBe('K1ABC');
    expect(s.st.partner?.sentRpt).toBe(false);
    // Nothing goes out until the operator enables Tx again.
    s.run(3, 5);
    expect(s.sent).toHaveLength(2);
    s.send({ type: 'enableTx', on: true, nowMs: s.at(6, 0.2) });
    s.run(6, 6);
    expect(texts(s).at(-1)).toBe('6:K1ABC 9V1NE -10');
  });

  it('Halt ends a CQ with nobody in a QSO; the watchdog and audio stops keep it for Enable Tx', () => {
    const s = new Sim();
    s.send({ type: 'callCq', nowMs: s.at(0, 0.1) });
    s.send({ type: 'halt', nowMs: s.at(0, 1) });
    expect(s.st).toMatchObject({ phase: 'idle', current: null, next: null });
    const w = new Sim({ watchdogMs: 60_000 });
    w.send({ type: 'callCq', nowMs: w.at(0, 0.1) });
    w.send({ type: 'tick', nowMs: w.at(4, 0.2) });
    expect(w.st).toMatchObject({ phase: 'cq', current: 6, txEnabled: false });
    w.send({ type: 'enableTx', on: true, nowMs: w.at(5, 1) });
    w.run(6, 6);
    expect(texts(w)).toEqual(['6:CQ 9V1NE OJ11']);
  });

  it('Enable Tx off lets the current transmission finish and cancels the next', () => {
    const s = new Sim();
    s.send({ type: 'callCq', nowMs: s.at(0, 0.1) });
    const fx = s.send({ type: 'enableTx', on: false, nowMs: s.at(0, 1) });
    expect(fx).toContainEqual({ type: 'cancelTx', stopPlaying: false });
  });

  it('stops Tx on an audio interruption, keeps the QSO and waits for audio and Enable Tx', () => {
    const s = new Sim();
    s.call(1, 'CQ JA1KXM PM95');
    s.run(2, 3, { 3: ['9V1NE JA1KXM -09'] });
    s.send({ type: 'audioStopped', nowMs: s.at(4, 0.2) });
    expect(s.st).toMatchObject({ txEnabled: false, audioOk: false, current: 3 });
    expect(s.notices().at(-1)?.kind).toBe('audio');
    s.send({ type: 'enableTx', on: true, nowMs: s.at(4, 0.3) });
    expect(s.pending).toBeNull();
    expect(notReady(s.st)).toBe('Audio off');
    s.send({ type: 'audioResumed', nowMs: s.at(5, 1) });
    expect(s.st.txEnabled).toBe(true);
    s.send({ type: 'enableTx', on: true, nowMs: s.at(5, 1.1) });
    s.run(6, 6);
    expect(texts(s).at(-1)).toBe('6:JA1KXM 9V1NE R-10');
  });

  it('transmits without a band confirmation', () => {
    const s = new Sim();
    s.send({ type: 'callCq', nowMs: s.at(0, 0.1) });
    expect(notReady(s.st)).toBeNull();
    s.run(0, 2);
    expect(texts(s)).toEqual(['0:CQ 9V1NE OJ11', '2:CQ 9V1NE OJ11']);
    expect(s.notices()).toEqual([]);
  });

  it('keeps Tx and the QSO through a band change', () => {
    const s = new Sim();
    s.call(1, 'CQ JA1KXM PM95');
    s.send({ type: 'configure', patch: { band: '40m', dialHz: 7_074_000 }, nowMs: s.at(1, 14) });
    expect(s.st).toMatchObject({ txEnabled: true, phase: 'answering', partner: { call: 'JA1KXM' } });
    s.run(2, 6, { 3: ['9V1NE JA1KXM -09'], 5: ['9V1NE JA1KXM RR73'] });
    expect(texts(s)).toEqual(['2:JA1KXM 9V1NE OJ11', '4:JA1KXM 9V1NE R-10', '6:JA1KXM 9V1NE 73']);
    expect(s.logged()[0]).toMatchObject({ band: '40m', dialHz: 7_074_000 });
  });

  it('stops Tx and ends the QSO on a mode change', () => {
    const s = new Sim();
    s.call(1, 'CQ JA1KXM PM95');
    s.effects = [];
    s.send({ type: 'configure', patch: { mode: 'FT4' }, nowMs: s.at(1, 14) });
    expect(s.st).toMatchObject({ txEnabled: false, phase: 'idle', partner: null, next: null });
    expect(s.effects).toContainEqual({ type: 'cancelTx', stopPlaying: true });
  });

  it('ends a QSO by hand without logging it', () => {
    const s = new Sim();
    s.send({ type: 'editMessage', tx: 6, text: 'CQ POTA 9V1NE OJ11', nowMs: s.at(0, 1) });
    s.call(1, 'CQ JA1KXM PM95');
    s.run(2, 3, { 3: ['9V1NE JA1KXM -09'] });
    s.send({ type: 'endQso', nowMs: s.at(3, 14) });
    expect(s.st).toMatchObject({ txEnabled: false, hunt: false, phase: 'idle', partner: null, current: null, next: null, edits: { 6: 'CQ POTA 9V1NE OJ11' } });
    s.run(4, 6, { 5: ['9V1NE JA1KXM RR73'] });
    expect(s.logged()).toEqual([]);
    expect(texts(s)).toEqual(['2:JA1KXM 9V1NE OJ11']);
  });

  it('cannot transmit without a callsign and grid', () => {
    for (const over of [{ myCall: '' }, { myGrid: '' }, { myGrid: 'XX99' }]) {
      const s = new Sim(over);
      s.send({ type: 'callCq', nowMs: s.at(0, 0.1) });
      expect(s.pending, JSON.stringify(over)).toBeNull();
      expect(notReady(s.st)).toBe('Set callsign and grid in Settings');
    }
  });

  it('starts nothing without an operator action', () => {
    const s = new Sim();
    s.run(0, 10, { 1: ['CQ JA1KXM PM95'], 3: ['9V1NE K1ABC FN42'] });
    expect(s.sent).toEqual([]);
    expect(s.effects.filter((f) => f.type === 'scheduleTx')).toEqual([]);
  });
});

describe('the audio layer', () => {
  it('notes a transmission other than the planned one and keeps the plan for the missed report', () => {
    const s = new Sim();
    s.send({ type: 'callCq', nowMs: s.at(0, 0.1) });
    s.hear(-1, ['9V1NE K1ABC FN42']);
    // The reply to K1ABC replaced CQ for slot 0, but the CQ was already on air.
    s.send({ type: 'txStarted', slotStartMs: s.at(0), text: 'CQ 9V1NE OJ11', nowMs: s.at(0, 0.5) });
    expect(s.st.onAir).toEqual({ tx: 6, text: 'CQ 9V1NE OJ11', slotStartMs: s.at(0), freqHz: null });
    expect(s.st.next).toMatchObject({ tx: 2, slotStartMs: s.at(0) });
    s.send({ type: 'txMissed', slotStartMs: s.at(0), nowMs: s.at(0, 0.6) });
    expect(s.st.next).toMatchObject({ tx: 2, slotStartMs: s.at(2) });
    s.send({ type: 'txEnded', slotStartMs: s.at(0), text: 'CQ 9V1NE OJ11', complete: true, nowMs: s.at(0, 13.2) });
    expect(s.st.lastSent?.tx).toBe(6);
  });
});

describe('a refused transmission', () => {
  it('waits for its slot to pass before planning again, once a slot', () => {
    const s = new Sim();
    s.send({ type: 'callCq', nowMs: s.at(0, 0.1) });
    expect(s.st.next).toMatchObject({ tx: 6, slotStartMs: s.at(0), scheduled: true });
    // The output refuses at once (audio not running). The scheduler answers inside the same call,
    // so planning again here recursed slot after slot until the stack overflowed.
    const fx = s.send({ type: 'txRefused', slotStartMs: s.at(0), nowMs: s.at(0, 0.1) });
    expect(fx.filter((f) => f.type === 'scheduleTx')).toEqual([]);
    expect(s.st.next).toMatchObject({ slotStartMs: s.at(0), scheduled: false });
    expect(s.send({ type: 'tick', nowMs: s.at(0, 1) }).filter((f) => f.type === 'scheduleTx')).toEqual([]);
    // Once the slot's last start has passed, tick plans the next CQ slot.
    s.send({ type: 'tick', nowMs: s.at(1, 0.5) });
    expect(s.st.next).toMatchObject({ tx: 6, slotStartMs: s.at(2), scheduled: true });
  });
});

describe('messages and planning', () => {
  it('lets the operator choose and edit the next message', () => {
    const s = new Sim();
    s.call(1, 'CQ JA1KXM PM95');
    s.send({ type: 'chooseNext', tx: 2, nowMs: s.at(2, 0.2) });
    s.send({ type: 'editMessage', tx: 2, text: 'ja1kxm 9v1ne -01', nowMs: s.at(2, 0.25) });
    s.run(2, 2);
    expect(texts(s)).toEqual(['2:JA1KXM 9V1NE -01']);
  });

  it('switches to CQ when the operator chooses Tx6', () => {
    const s = new Sim();
    s.call(1, 'CQ JA1KXM PM95');
    s.send({ type: 'chooseNext', tx: 6, nowMs: s.at(2, 0.2) });
    expect(s.st.phase).toBe('cq');
    expect(s.st.partner).toBeNull();
  });

  it('places our slot after the current one when the parity differs', () => {
    const s = new Sim();
    const st: SeqState = { ...s.st, parity: 'odd' };
    expect(ourSlot(st, T0 + 3000)).toEqual({ slotStartMs: T0 + 15000, offsetS: 0.5, tooLateFor: null });
  });

  it('plans again for a changed callsign, grid or acknowledgement, and not for unchanged settings', () => {
    const s = new Sim();
    s.send({ type: 'callCq', nowMs: s.at(0, 1) });
    expect(s.pending?.text).toBe('CQ 9V1NE OJ11');
    s.effects = [];
    // Settings send the whole configuration whenever one value changes, here the Tx frequency.
    s.send({ type: 'configure', patch: { myCall: '9V1NE', myGrid: 'OJ11', ack: 'RR73', txHz: 1846 }, nowMs: s.at(1, 1) });
    expect(s.effects.filter((f) => f.type === 'scheduleTx' || f.type === 'cancelTx')).toEqual([]);
    expect(s.st.config.txHz).toBe(1846);
    s.send({ type: 'configure', patch: { myCall: '9V1NE', myGrid: 'OJ12' }, nowMs: s.at(1, 2) });
    expect(s.pending?.text).toBe('CQ 9V1NE OJ12');
  });

  it('does not change the state it was given', () => {
    const s = new Sim();
    const before = JSON.stringify(s.st);
    reduce(s.st, { type: 'callCq', nowMs: s.at(0, 0.1) });
    expect(JSON.stringify(s.st)).toBe(before);
  });
});
