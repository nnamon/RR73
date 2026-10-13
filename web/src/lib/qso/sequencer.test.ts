import { describe, expect, it } from 'vitest';
import { LATE_S, notReady, ourSlot, reduce, type SeqState } from './sequencer';
import { Sim, T0, decode } from '../testing/qso-sim';

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
    expect(s.notices().at(-1)).toMatchObject({ kind: 'no-reply', text: 'No reply from JA1KXM after 3 repeats. Tap Call to try again.' });
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
  it('runs Tx6, Tx2 and Tx4 with a caller who sends a grid, logs after RR73, then calls CQ again', () => {
    const s = new Sim();
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
    const s = new Sim({ order });
    if (worked.length) s.send({ type: 'setWorked', worked: worked.map((call) => ({ call, band: '40m', mode: 'FT8', day: '20261001', grid: null })), nowMs: s.at(0) });
    s.send({ type: 'runMode', on: true, nowMs: s.at(0, 0.1) });
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
    const s = new Sim({ order: 'first' });
    s.send({ type: 'runMode', on: true, nowMs: s.at(0, 0.1) });
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
    const s = new Sim();
    s.send({ type: 'setWorked', worked: [{ call: 'K1ABC', ...today }], nowMs: s.at(0) });
    s.send({ type: 'runMode', on: true, nowMs: s.at(0, 0.1) });
    s.run(0, 2, { 1: [callers[0]] });
    expect(texts(s).at(-1)).toBe('2:CQ 9V1NE OJ11');
    expect(s.st.queue).toMatchObject([{ call: 'K1ABC', dupe: true }]);

    const w = new Sim({ workDupes: true });
    w.send({ type: 'setWorked', worked: [{ call: 'K1ABC', ...today }], nowMs: w.at(0) });
    w.send({ type: 'runMode', on: true, nowMs: w.at(0, 0.1) });
    w.run(0, 2, { 1: [callers[0]] });
    expect(texts(w).at(-1)).toBe('2:K1ABC 9V1NE -15');
  });

  it('does not count a QSO on another band or day as a dupe', () => {
    const s = new Sim();
    s.send({ type: 'setWorked', worked: [{ call: 'K1ABC', band: '40m', mode: 'FT8', day: '20261013', grid: null }, { call: 'K1ABC', band: '20m', mode: 'FT8', day: '20261012', grid: null }], nowMs: s.at(0) });
    s.send({ type: 'runMode', on: true, nowMs: s.at(0, 0.1) });
    s.run(0, 2, { 1: [callers[0]] });
    expect(texts(s).at(-1)).toBe('2:K1ABC 9V1NE -15');
  });

  it('repeats RR73 without Run when the caller repeats the R-report', () => {
    const s = new Sim();
    s.send({ type: 'callCq', nowMs: s.at(0, 0.1) });
    s.run(0, 6, { 1: ['9V1NE K1ABC FN42'], 3: ['9V1NE K1ABC R-12'], 5: ['9V1NE K1ABC R-12'] });
    expect(texts(s).slice(-2)).toEqual(['4:K1ABC 9V1NE RR73', '6:K1ABC 9V1NE RR73']);
    expect(s.logged()).toHaveLength(1);
  });

  it('makes a station worked in this run a dupe', () => {
    const s = new Sim();
    s.send({ type: 'runMode', on: true, nowMs: s.at(0, 0.1) });
    s.run(0, 6, { 1: [callers[0]], 3: ['9V1NE K1ABC R-12'], 5: [callers[0]] });
    expect(texts(s).at(-1)).toBe('6:CQ 9V1NE OJ11');
  });

  it('drops a caller who goes quiet after 3 repeats, unlogged, and moves on', () => {
    const s = new Sim();
    s.send({ type: 'runMode', on: true, nowMs: s.at(0, 0.1) });
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
    const s = new Sim();
    s.send({ type: 'runMode', on: true, nowMs: s.at(0, 0.1) });
    s.run(0, 10, { 1: callers.slice(0, 2), 9: [callers[1]] });
    expect(texts(s).at(-1)).toBe('10:JA1KXM 9V1NE -05');
  });

  it('lets callers go stale after 4 slots', () => {
    const s = new Sim();
    s.send({ type: 'runMode', on: true, nowMs: s.at(0, 0.1) });
    s.run(0, 1, { 1: callers.slice(0, 2) });
    expect(s.st.queue.map((c) => c.call)).toEqual(['JA1KXM']);
    s.run(2, 7, { 3: ['9V1NE K1ABC -12'] });
    expect(s.st.queue).toEqual([]);
  });

  it('adds callers from an early pass and decides only on the final pass', () => {
    const s = new Sim();
    s.send({ type: 'runMode', on: true, nowMs: s.at(0, 0.1) });
    s.run(0, 0);
    const early = s.hear(1, [callers[0]], -1.2, 'early');
    expect(early.map((f) => f.type)).toEqual(['queueChanged']);
    expect(s.st.queue.map((c) => c.call)).toEqual(['K1ABC']);
    s.hear(1, [callers[0]]);
    s.run(2, 2);
    expect(texts(s).at(-1)).toBe('2:K1ABC 9V1NE -15');
  });

  it('ends the run cleanly with Stop after this QSO', () => {
    const s = new Sim();
    s.send({ type: 'runMode', on: true, nowMs: s.at(0, 0.1) });
    s.run(0, 1, { 1: callers.slice(0, 2) });
    s.send({ type: 'stopAfterQso', on: true, nowMs: s.at(2, 3) });
    s.run(2, 6, { 3: ['9V1NE K1ABC R-12'] });
    expect(texts(s)).toEqual(['0:CQ 9V1NE OJ11', '2:K1ABC 9V1NE -15', '4:K1ABC 9V1NE RR73']);
    expect(s.logged()).toHaveLength(1);
    expect(s.st).toMatchObject({ run: false, txEnabled: false, phase: 'idle' });
  });

  it('turns Run off without ending the QSO in progress', () => {
    const s = new Sim();
    s.send({ type: 'runMode', on: true, nowMs: s.at(0, 0.1) });
    s.run(0, 1, { 1: callers.slice(0, 2) });
    s.send({ type: 'runMode', on: false, nowMs: s.at(2, 3) });
    expect(s.st.queue).toEqual([]);
    s.run(2, 4, { 3: ['9V1NE K1ABC R-12'] });
    expect(texts(s).at(-1)).toBe('4:K1ABC 9V1NE RR73');
  });
});

describe('late start', () => {
  it('starts up to 1.5 s late in FT8 and moves to the next slot of our parity after that', () => {
    const s = new Sim();
    for (const [after, slot, offset, tooLate] of [
      [0.1, 2, 0.5, null],
      [0.3, 2, 0.5, null],
      [1.0, 2, 1.2, null],
      [1.8, 2, 2.0, null],
      [1.81, 4, 0.5, 2],
    ] as const) {
      s.call(1, 'CQ JA1KXM PM95', after);
      expect(s.st.next, String(after)).toMatchObject({ slotStartMs: s.at(slot), offsetS: offset, tooLateFor: tooLate === null ? null : s.at(tooLate) });
    }
    expect(LATE_S.FT8).toBe(1.5);
  });

  it('allows 1.0 s in FT4', () => {
    const s = new Sim({ mode: 'FT4' });
    s.call(1, 'CQ JA1KXM PM95', 1.3);
    expect(s.st.next).toMatchObject({ slotStartMs: s.at(2), offsetS: 1.5 });
    s.call(1, 'CQ JA1KXM PM95', 1.31);
    expect(s.st.next).toMatchObject({ slotStartMs: s.at(4), offsetS: 0.5, tooLateFor: s.at(2) });
  });

  it('replans a transmission the audio layer missed', () => {
    const s = new Sim();
    s.call(1, 'CQ JA1KXM PM95');
    s.send({ type: 'txMissed', slotStartMs: s.at(2), nowMs: s.at(2, 2.1) });
    expect(s.st.next).toMatchObject({ slotStartMs: s.at(4), scheduled: true });
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
  it('stops Tx after 6 min without a touch while the message stays the same', () => {
    const s = new Sim();
    s.send({ type: 'callCq', nowMs: s.at(0, 0.1) });
    s.run(0, 22);
    // The first CQ is a new message: the count runs from its start, 13:14:00.5.
    s.send({ type: 'tick', nowMs: s.at(24, 0.45) });
    expect(s.st.txEnabled).toBe(true);
    s.send({ type: 'tick', nowMs: s.at(24, 0.5) });
    expect(s.st).toMatchObject({ txEnabled: false, run: false });
    expect(s.notices().at(-1)).toMatchObject({ kind: 'watchdog', text: 'Tx stopped: 6 min without a touch or a new message. Enable Tx to carry on.' });
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

  it('resets when the transmitted message changes', () => {
    const s = new Sim();
    s.send({ type: 'callCq', nowMs: s.at(0, 0.1) });
    s.run(0, 20);
    s.run(21, 22, { 21: ['9V1NE K1ABC FN42'] });
    s.send({ type: 'tick', nowMs: s.at(25) });
    expect(s.st.txEnabled).toBe(true);
    expect(s.st.watchdogFromMs).toBe(s.at(22, 0.5));
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
  it('Halt stops at once, disables Tx and Run, and keeps the QSO', () => {
    const s = new Sim();
    s.send({ type: 'runMode', on: true, nowMs: s.at(0, 0.1) });
    s.run(0, 1, { 1: ['9V1NE K1ABC FN42'] });
    s.play(2, 3.2);
    expect(s.effects.filter((f) => f.type === 'cancelTx').at(-1)).toEqual({ type: 'cancelTx', stopPlaying: true });
    expect(s.st).toMatchObject({ txEnabled: false, run: false, phase: 'cq' });
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
    expect(notReady(s.st)).toBe('Resume audio to transmit.');
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
    expect(s.st).toMatchObject({ txEnabled: false, run: false, phase: 'idle', partner: null, current: null, next: null, edits: { 6: 'CQ POTA 9V1NE OJ11' } });
    s.run(4, 6, { 5: ['9V1NE JA1KXM RR73'] });
    expect(s.logged()).toEqual([]);
    expect(texts(s)).toEqual(['2:JA1KXM 9V1NE OJ11']);
  });

  it('cannot transmit without a callsign and grid', () => {
    for (const over of [{ myCall: '' }, { myGrid: '' }, { myGrid: 'XX99' }]) {
      const s = new Sim(over);
      s.send({ type: 'callCq', nowMs: s.at(0, 0.1) });
      expect(s.pending, JSON.stringify(over)).toBeNull();
      expect(notReady(s.st)).toBe('Set your callsign and grid in Settings to transmit.');
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
    expect(s.st.onAir).toEqual({ tx: 6, text: 'CQ 9V1NE OJ11', slotStartMs: s.at(0) });
    expect(s.st.next).toMatchObject({ tx: 2, slotStartMs: s.at(0) });
    s.send({ type: 'txMissed', slotStartMs: s.at(0), nowMs: s.at(0, 0.6) });
    expect(s.st.next).toMatchObject({ tx: 2, slotStartMs: s.at(2) });
    s.send({ type: 'txEnded', slotStartMs: s.at(0), text: 'CQ 9V1NE OJ11', complete: true, nowMs: s.at(0, 13.2) });
    expect(s.st.lastSent?.tx).toBe(6);
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
