// Hound mode (FT8 DXpedition mode, docs/design/hound.md) against slot timelines. The Fox
// transmits in even slots, from 300 Hz on streams 60 Hz apart; we call in odd slots.
import { describe, expect, it } from 'vitest';
import { HOUND_MIN_HZ, houndCallHz, houndRepeatHz, reduce, type SeqConfig } from './sequencer';
import { foxCall, fromFox, parseExchange, parseParts } from './messages';
import { houndText, steps } from './view';
import { Sim, decode } from '../testing/qso-sim';

const texts = (s: Sim) => s.sent.map((t) => `${t.slot}:${t.text}${t.freqHz === null ? '' : ` @${t.freqHz}`}`);
const kinds = (s: Sim) => s.notices().map((n) => n.kind);

/** Hound on, the Fox's CQ heard in slot 0 and double-tapped: Tx1 goes out in slot 1. */
function calling(over: Partial<SeqConfig> = {}): Sim {
  const s = new Sim({ hound: true, ...over });
  s.hear(0, [decode('CQ KH1/KH7Z', -6, 300)]);
  s.call(0, decode('CQ KH1/KH7Z', -6, 300));
  return s;
}

describe('multi-call messages', () => {
  it('read as RR73 to the first station and a report to the second, both from the Fox', () => {
    const [a, b] = parseParts('K1ABC RR73; 9V1NE <KH1/KH7Z> -08');
    expect(a).toEqual({ to: 'K1ABC', from: '<KH1/KH7Z>', kind: 'rr73', grid: null, report: null, modifier: null, multi: true });
    expect(b).toEqual({ to: '9V1NE', from: '<KH1/KH7Z>', kind: 'report', grid: null, report: -8, modifier: null, multi: true });
    expect(fromFox(b, 'KH1/KH7Z')).toBe(true);
    expect(fromFox(b, 'KH7Z')).toBe(true);
    expect(fromFox(b, 'VP8PJ')).toBe(false);
  });

  it('with the Fox unknown, <...> counts as the Fox only in a multi-call message', () => {
    const [, b] = parseParts('K1ABC RR73; 9V1NE <...> +04');
    expect(b.report).toBe(4);
    expect(fromFox(b, 'VP8PJ')).toBe(true);
    expect(fromFox(parseExchange('9V1NE <...> -10'), 'VP8PJ')).toBe(false);
  });

  it('other messages give one part, as parseExchange reads them', () => {
    expect(parseParts('9V1NE KH7Z -13')).toEqual([parseExchange('9V1NE KH7Z -13')]);
    expect(parseParts('K1ABC RR73; W9XYZ KH7Z')).toEqual([parseExchange('K1ABC RR73; W9XYZ KH7Z')]);
  });

  it('a Hound calls a compound Fox by its base callsign', () => {
    expect(foxCall('KH1/KH7Z')).toBe('KH7Z');
    expect(foxCall('<VP8PJ>')).toBe('VP8PJ');
  });
});

describe('Hound', () => {
  it('calls, answers the report in a multi-call message with the R-report on its frequency, and logs on RR73', () => {
    const s = calling();
    s.run(1, 6, {
      // The Fox works others: a report and a multi-call message without us.
      2: [decode('W9XYZ KH7Z -13', -15, 300), decode('G4AAA RR73; K1ABC <KH1/KH7Z> -10', -16, 360)],
      // Our report inside a multi-call message, the Fox's callsign not yet resolved.
      4: [decode('W9XYZ KH7Z -13', -15, 300), decode('K1ABC RR73; 9V1NE <...> -12', -14, 360)],
      6: [decode('9V1NE KH7Z RR73', -13, 360), decode('W9XYZ RR73; DL2ABC <KH1/KH7Z> -06', -15, 300)],
    });
    expect(texts(s)).toEqual(['1:KH7Z 9V1NE OJ11', '3:KH7Z 9V1NE OJ11', '5:KH7Z 9V1NE R-14 @360']);
    const [rec] = s.logged();
    expect(rec).toMatchObject({ call: 'KH1/KH7Z', reportSent: '-14', reportRcvd: '-12' });
    expect(s.st.txEnabled).toBe(false);
    expect(s.st.phase).toBe('idle');
    expect(houndText(s.st)).toBe('Logged · KH1/KH7Z');
    s.run(7, 8);
    expect(s.sent).toHaveLength(3);
    expect(kinds(s)).toEqual([]);
  });

  it('logs on RR73 inside a multi-call message', () => {
    const s = calling();
    s.run(1, 4, { 2: [decode('9V1NE KH7Z -10', -12, 420)], 4: [decode('9V1NE RR73; W9XYZ <KH1/KH7Z> -14', -12, 420)] });
    expect(texts(s)).toEqual(['1:KH7Z 9V1NE OJ11', '3:KH7Z 9V1NE R-12 @420']);
    expect(s.logged().map((r) => r.call)).toEqual(['KH1/KH7Z']);
  });

  it('finds its report among several Fox streams in one slot', () => {
    const s = calling();
    s.run(1, 2, {
      2: [
        decode('W9XYZ KH7Z -13', -15, 300),
        decode('JA1XYZ RR73; G4ABC <KH1/KH7Z> -14', -15, 360),
        decode('K1ABC RR73; 9V1NE <KH1/KH7Z> -06', -16, 420),
      ],
    });
    s.play(3);
    expect(texts(s)).toEqual(['1:KH7Z 9V1NE OJ11', '3:KH7Z 9V1NE R-16 @420']);
  });

  it('keeps calling while the Fox works others, with no lost-station notice and no tail-end call', () => {
    const s = calling({ tailEnd: true });
    const others = [decode('W9XYZ KH7Z -13', -15, 300), decode('W9XYZ RR73; G4AAA <KH1/KH7Z> -10', -15, 300), decode('G4AAA KH7Z RR73', -15, 360)];
    s.run(1, 12, { 2: others, 4: others, 6: others, 8: others, 10: others, 12: others });
    // Tx1 repeats past the retry limit: the watchdog ends it.
    expect(s.sent.map((t) => t.text)).toEqual(Array(6).fill('KH7Z 9V1NE OJ11'));
    expect(s.st.lost).toBeNull();
    expect(kinds(s)).toEqual([]);
    expect(houndText(s.st)).toBe('Calling the Fox · KH1/KH7Z');
  });

  it('without Hound the same slot reads as a lost station', () => {
    const s = calling({ hound: false });
    s.run(1, 2, { 2: [decode('W9XYZ KH1/KH7Z -13', -15, 300)] });
    expect(kinds(s)).toContain('lost');
  });

  it('the watchdog stops the calls as usual', () => {
    const s = calling({ watchdogMs: 60_000 });
    s.run(1, 5);
    s.send({ type: 'tick', nowMs: s.at(6) });
    expect(s.st.txEnabled).toBe(false);
    expect(kinds(s)).toEqual(['watchdog']);
  });

  it('ignores RR73 to us before any report: another Hound gets those', () => {
    const s = calling();
    s.run(1, 3, { 2: [decode('9V1NE KH7Z RR73', -12, 300)] });
    expect(s.logged()).toEqual([]);
    expect(texts(s)).toEqual(['1:KH7Z 9V1NE OJ11', '3:KH7Z 9V1NE OJ11']);
  });

  it('repeats the R-report 300 Hz away, up to the retry limit, then gives up without logging', () => {
    const s = calling();
    s.run(1, 12, { 2: [decode('9V1NE KH7Z -10', -12, 360)] });
    expect(texts(s)).toEqual(['1:KH7Z 9V1NE OJ11', '3:KH7Z 9V1NE R-12 @360', '5:KH7Z 9V1NE R-12 @660', '7:KH7Z 9V1NE R-12 @660', '9:KH7Z 9V1NE R-12 @660']);
    expect(s.notices().at(-1)!.text).toBe('No reply from KH1/KH7Z · not logged');
    expect(s.logged()).toEqual([]);
    expect(s.st.txEnabled).toBe(false);
  });

  it('answers a repeated report on its new stream, moved 300 Hz, and logs on the RR73 that follows', () => {
    const s = calling();
    s.run(1, 6, { 2: [decode('9V1NE KH7Z -10', -12, 360)], 4: [decode('W9XYZ RR73; 9V1NE <KH1/KH7Z> -10', -12, 720)], 6: [decode('9V1NE KH7Z RR73', -12, 300)] });
    expect(texts(s)).toEqual(['1:KH7Z 9V1NE OJ11', '3:KH7Z 9V1NE R-12 @360', '5:KH7Z 9V1NE R-12 @420']);
    expect(s.logged()).toHaveLength(1);
  });

  it('calls at 1000 Hz or above', () => {
    const low = calling({ txHz: 600 });
    low.run(1, 1);
    expect(texts(low)).toEqual(['1:KH7Z 9V1NE OJ11 @1000']);
    expect(houndCallHz(600)).toBe(HOUND_MIN_HZ);
    expect(houndCallHz(1800)).toBe(1800);
    expect(houndRepeatHz(540)).toBe(840);
    expect(houndRepeatHz(700)).toBe(400);
  });

  it('a double-tap on the report to us answers it at once on its frequency', () => {
    const s = new Sim({ hound: true });
    const d = decode('K1ABC RR73; 9V1NE <KH1/KH7Z> -08', -11, 480);
    s.hear(0, [d]);
    s.call(0, d);
    s.run(1, 1);
    expect(texts(s)).toEqual(['1:KH7Z 9V1NE R-11 @480']);
  });

  it('a double-tap on a multi-call message with the Fox unknown names the problem', () => {
    const s = new Sim({ hound: true });
    s.call(0, decode('K1ABC RR73; W9XYZ <...> -08', -11, 480));
    expect(s.st.partner).toBeNull();
    expect(s.notices().map((n) => n.text)).toEqual(['Fox callsign not in this message']);
  });

  it('shows the stage in the status line and ends the steps with Logged', () => {
    const s = calling();
    s.run(1, 2, { 2: [decode('9V1NE KH7Z -10', -12, 360)] });
    expect(houndText(s.st)).toBe('Report received · −10 dB from KH1/KH7Z');
    expect(steps(s.st).map((x) => x.label)).toEqual(['Grid', '−10', 'R−12', 'RR73', 'Logged']);
    expect(houndText({ ...s.st, config: { ...s.st.config, hound: false } })).toBeNull();
  });

  it('turning Hound off or on ends the QSO in progress', () => {
    const s = calling();
    s.run(1, 1);
    const r = reduce(s.st, { type: 'configure', patch: { hound: false }, nowMs: s.at(2) });
    expect(r.state.partner).toBeNull();
    expect(r.state.txEnabled).toBe(false);
  });
});
