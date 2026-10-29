import { describe, expect, it } from 'vitest';
import { messages, reduce } from './sequencer';
import { buildMessages, formatReport, parseExchange, parseParts, txNums } from './messages';
import { steps } from './view';
import { Sim, decode } from '../testing/qso-sim';

/** The 4-message LQ8 QSO (docs/design/lq8.md), with 9V1NE as the operator. */
const lq8 = (over = {}) => new Sim({ mode: 'LQ8', dialHz: 14_084_000, ...over });
const texts = (s: Sim) => s.sent.map((t) => `${t.slot}:${t.text}`);

describe('LQ8 messages', () => {
  it('reads the call with grid and report, REPORT+73 and 73', () => {
    expect(parseExchange('9V1NE AB4SS FN42 -03')).toMatchObject({ to: '9V1NE', from: 'AB4SS', kind: 'report', grid: 'FN42', report: -3 });
    expect(parseExchange('<9V1NE> AB4SS/P FN42 +05')).toMatchObject({ to: '<9V1NE>', from: 'AB4SS/P', kind: 'report', grid: 'FN42', report: 5 });
    expect(parseExchange('<9V1NE> VP8/AB4SS -12')).toMatchObject({ to: '<9V1NE>', from: 'VP8/AB4SS', kind: 'report', report: -12 });
    expect(parseExchange('9V1NE AB4SS R+05')).toMatchObject({ kind: 'rreport', report: 5 });
    expect(parseExchange('9V1NE AB4SS 73')).toMatchObject({ kind: '73' });
  });

  it('gives one part per target of the multi-station messages, from their sender', () => {
    expect(parseParts('<OE3OGC> R+05 <9V1NE> R-03 <AB4SS>')).toEqual([
      { to: '<OE3OGC>', from: '<AB4SS>', kind: 'rreport', grid: null, report: 5, modifier: null, multi: true },
      { to: '<9V1NE>', from: '<AB4SS>', kind: 'rreport', grid: null, report: -3, modifier: null, multi: true },
    ]);
    expect(parseParts('<9V1NE> R-07 <AB4SS>')).toMatchObject([{ to: '<9V1NE>', from: '<AB4SS>', kind: 'rreport', report: -7 }]);
    expect(parseParts('<OE3OGC> <9V1NE> <...> 73').map((p) => [p.to, p.from, p.kind])).toEqual([
      ['<OE3OGC>', '<...>', '73'],
      ['<9V1NE>', '<...>', '73'],
    ]);
    // The first part stands for the message where one part is read.
    expect(parseExchange('<OE3OGC> R+05 <9V1NE> R-03 <AB4SS>')).toMatchObject({ to: '<OE3OGC>', from: '<AB4SS>' });
  });

  it('leaves FT8 text as before', () => {
    // Plain callsigns are never a multi-station message: those always bracket the sender.
    expect(parseParts('K1ABC R-05 W9XYZ')).toEqual([parseExchange('K1ABC R-05 W9XYZ')]);
    expect(parseExchange('K1ABC W9XYZ R-05').kind).toBe('rreport');
    expect(parseExchange('K1ABC W9XYZ FN42').kind).toBe('grid');
  });

  it('builds the call, REPORT+73, 73 and CQ, with reports in LQ8 range', () => {
    const p = { dx: 'AB4SS', me: '9V1NE', grid: 'OJ11ab', report: -11, ack: 'RR73', cqModifier: null, lq8: true } as const;
    expect(buildMessages(p)).toEqual({ 1: 'AB4SS 9V1NE OJ11 -11', 2: '', 3: 'AB4SS 9V1NE R-11', 4: '', 5: 'AB4SS 9V1NE 73', 6: 'CQ 9V1NE OJ11' });
    expect(buildMessages({ ...p, report: 12 })[3]).toBe('AB4SS 9V1NE R+05');
    expect(buildMessages({ ...p, report: -40 })[1]).toBe('AB4SS 9V1NE OJ11 -26');
    expect(formatReport(12, true)).toBe('+05');
    expect(formatReport(12)).toBe('+12');
    expect(txNums('LQ8')).toEqual([1, 3, 5, 6]);
    expect(txNums('FT8')).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('answering a CQ in LQ8', () => {
  it('sends the call, logs on their REPORT+73 and ends with 73', () => {
    const s = lq8();
    s.call(1, decode('CQ AB4SS FN42', -11, 1418, 0.2));
    s.run(2, 4, { 3: [decode('9V1NE AB4SS R+05', -9, 1418, 0.2)] });
    expect(texts(s)).toEqual(['2:AB4SS 9V1NE OJ11 -11', '4:AB4SS 9V1NE 73']);
    const [rec] = s.logged();
    expect(rec).toMatchObject({ call: 'AB4SS', grid: 'FN42', mode: 'LQ8', dialHz: 14_084_000, reportSent: '-11', reportRcvd: '+05' });
    expect(s.st).toMatchObject({ phase: 'idle', txEnabled: false, partner: null });
  });

  it('logs at the moment their REPORT+73 is decoded, before our 73', () => {
    const s = lq8();
    s.call(1, 'CQ AB4SS FN42');
    s.run(2, 2);
    const fx = s.hear(3, ['9V1NE AB4SS R-02']);
    expect(fx.map((f) => f.type)).toEqual(['logQso', 'scheduleTx']);
    expect(s.st.next?.text).toBe('AB4SS 9V1NE 73');
  });

  it('calls again while their REPORT+73 does not come, up to the retry limit', () => {
    const s = lq8();
    s.call(1, 'CQ AB4SS FN42');
    s.run(2, 10, {});
    expect(texts(s)).toEqual(['2:AB4SS 9V1NE OJ11 -10', '4:AB4SS 9V1NE OJ11 -10', '6:AB4SS 9V1NE OJ11 -10', '8:AB4SS 9V1NE OJ11 -10']);
    expect(s.notices().map((n) => n.kind)).toContain('no-reply');
    expect(s.logged()).toEqual([]);
  });

  it('takes REPORT+73 inside a multi-station message, to us as either target', () => {
    for (const multi of ['<9V1NE> R-04 <OE3OGC> R+01 <AB4SS>', '<OE3OGC> R+01 <9V1NE> R-04 <AB4SS>', '<9V1NE> R-04 <AB4SS>']) {
      const s = lq8();
      s.call(1, 'CQ AB4SS FN42');
      s.run(2, 4, { 3: [multi] });
      expect(texts(s), multi).toEqual(['2:AB4SS 9V1NE OJ11 -10', '4:AB4SS 9V1NE 73']);
      expect(s.logged()[0], multi).toMatchObject({ call: 'AB4SS', reportRcvd: '-04' });
    }
  });

  it('ignores a multi-station message to other stations, and one from another sender', () => {
    const s = lq8();
    s.call(1, 'CQ AB4SS FN42');
    s.run(2, 3, { 3: ['<9V1NE> R-04 <OE3OGC> R+01 <9V1DE>'] });
    expect(s.logged()).toEqual([]);
    expect(s.st.lost).toBeNull();
  });

  it('calls the station once more after it ends a QSO with another (tail-end)', () => {
    const s = lq8();
    s.call(1, 'CQ AB4SS FN42');
    s.run(2, 4, { 3: ['OE3OGC AB4SS R-08'] });
    expect(s.notices().map((n) => n.text)).toContain('AB4SS answered OE3OGC');
    // REPORT+73 is the last message of the station that called CQ: the next slot is ours.
    expect(texts(s)).toEqual(['2:AB4SS 9V1NE OJ11 -10', '4:AB4SS 9V1NE OJ11 -10']);
  });

  it('shows 3 steps: our call, their R-report, our 73', () => {
    const s = lq8();
    s.call(1, 'CQ AB4SS FN42');
    s.run(2, 2);
    expect(steps(s.st).map((x) => `${x.label}:${x.state}`)).toEqual(['OJ11:done', 'R-report:now', '73:todo']);
    s.hear(3, ['9V1NE AB4SS R+05']);
    expect(steps(s.st).map((x) => `${x.label}:${x.state}`)).toEqual(['OJ11:done', 'R+05:done', '73:now']);
  });

  it('answers a station that calls us directly with REPORT+73', () => {
    const s = lq8();
    s.call(1, '9V1NE AB4SS FN42 -07');
    s.run(2, 2);
    expect(texts(s)).toEqual(['2:AB4SS 9V1NE R-10']);
  });
});

describe('calling CQ in LQ8', () => {
  it('answers a caller with REPORT+73 and logs on their 73', () => {
    const s = lq8();
    s.send({ type: 'callCq', nowMs: s.at(0, -1) });
    s.run(0, 3, { 1: [decode('9V1NE AB4SS FN42 -15', -14)], 3: ['9V1NE AB4SS 73'] });
    expect(texts(s)).toEqual(['0:CQ 9V1NE OJ11', '2:AB4SS 9V1NE R-14']);
    expect(s.logged()[0]).toMatchObject({ call: 'AB4SS', grid: 'FN42', mode: 'LQ8', reportSent: '-14', reportRcvd: '-15' });
    expect(s.st.phase).toBe('idle');
    expect(s.st.txEnabled).toBe(false);
  });

  it('takes a MULTI-73 that names us as their 73', () => {
    const s = lq8();
    s.send({ type: 'callCq', nowMs: s.at(0, -1) });
    s.run(0, 3, { 1: ['9V1NE AB4SS FN42 -15'], 3: ['<OE3OGC> <9V1NE> <AB4SS> 73'] });
    expect(s.logged()).toHaveLength(1);
  });

  it('sends REPORT+73 again to a caller who calls again, and drops a silent one unlogged', () => {
    const s = lq8();
    s.send({ type: 'callCq', nowMs: s.at(0, -1) });
    s.run(0, 5, { 1: ['9V1NE AB4SS FN42 -15'], 3: ['9V1NE AB4SS FN42 -15'], 5: ['9V1NE AB4SS 73'] });
    expect(texts(s)).toEqual(['0:CQ 9V1NE OJ11', '2:AB4SS 9V1NE R-10', '4:AB4SS 9V1NE R-10']);
    expect(s.logged()).toHaveLength(1);

    const q = lq8();
    q.send({ type: 'callCq', nowMs: q.at(0, -1) });
    q.run(0, 11, { 1: ['9V1NE AB4SS FN42 -15'] });
    expect(q.logged()).toEqual([]);
    expect(q.notices().map((n) => n.kind)).toContain('dropped');
    // Back to CQ after the caller who did not finish.
    expect(texts(q).at(-1)).toBe('10:CQ 9V1NE OJ11');
  });

  it('goes on to the next caller with Repeat CQ on, skipping a REPORT+73 step', () => {
    const s = lq8({ run: true });
    s.send({ type: 'callCq', nowMs: s.at(0, -1) });
    s.run(0, 5, { 1: ['9V1NE AB4SS FN42 -15'], 3: ['9V1NE AB4SS 73', '9V1NE OE3OGC JN78 -09'] });
    expect(texts(s)).toEqual(['0:CQ 9V1NE OJ11', '2:AB4SS 9V1NE R-10', '4:OE3OGC 9V1NE R-10']);
    expect(s.logged().map((r) => r.call)).toEqual(['AB4SS']);
  });

  it('shows 4 steps: their call, our R-report, their 73, logged', () => {
    const s = lq8();
    s.send({ type: 'callCq', nowMs: s.at(0, -1) });
    s.run(0, 2, { 1: ['9V1NE AB4SS FN42 -15'] });
    expect(steps(s.st).map((x) => `${x.label}:${x.state}`)).toEqual(['FN42:done', 'R\u221210:done', '73:now', 'Logged:todo']);
  });
});

describe('LQ8 with the other features', () => {
  it('runs Hunt through LQ8 QSOs', () => {
    const s = lq8();
    s.send({ type: 'hunt', on: true, nowMs: s.at(1, -2) });
    s.hear(1, ['CQ AB4SS FN42']);
    s.run(2, 4, { 3: ['9V1NE AB4SS R-01'] });
    expect(texts(s)).toEqual(['2:AB4SS 9V1NE OJ11 -10', '4:AB4SS 9V1NE 73']);
    expect(s.logged()).toHaveLength(1);
    expect(s.st.hunt).toBe(true);
    expect(s.st.huntQsos).toBe(1);
  });

  it('reads no exchange formats with Contest exchange set', () => {
    const s = lq8({ exchange: '1D WI' });
    s.call(1, 'CQ FD AB4SS FN42');
    s.run(2, 2);
    expect(texts(s)).toEqual(['2:AB4SS 9V1NE OJ11 -10']);
  });

  it('lets the watchdog end a QSO under way after it, and Halt stops at once', () => {
    const s = lq8({ watchdogMs: 60_000 });
    s.call(1, 'CQ AB4SS FN42');
    s.run(2, 3, { 3: ['9V1NE AB4SS R+02'] });
    s.send({ type: 'tick', nowMs: s.at(4, 1) });
    s.run(4, 5);
    expect(texts(s).at(-1)).toBe('4:AB4SS 9V1NE 73');
    expect(s.logged()).toHaveLength(1);
    expect(s.st.txEnabled).toBe(false);

    const h = lq8();
    h.call(1, 'CQ AB4SS FN42');
    h.send({ type: 'halt', nowMs: h.at(2, 1) });
    expect(h.st.txEnabled).toBe(false);
  });

  it('sends free text from an edited message', () => {
    const s = lq8();
    s.send({ type: 'callCq', nowMs: s.at(0, -1) });
    const r = reduce(s.st, { type: 'editMessage', tx: 6, text: 'tnx fer qso', nowMs: s.at(0, 1) });
    expect(messages(r.state)[6]).toBe('TNX FER QSO');
  });
});
