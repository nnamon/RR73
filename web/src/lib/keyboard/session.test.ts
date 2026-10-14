import { describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { KeyboardSession, TX_AHEAD_S, type SessionConfig } from './session.svelte';
import { defaultMacros, type Macro } from './macros';
import type { LogQsoRecord } from '../log/types';
import type { ModemEvent } from './modem';

const T = Date.UTC(2026, 9, 14, 14, 4, 0);
const CHAR_S = 7.5 / 45.45;

function rig(over: Partial<SessionConfig> = {}) {
  let now = T;
  const config: SessionConfig = {
    charS: CHAR_S,
    upperCaseOnly: true,
    newLineFirst: true,
    idleStopS: 60,
    watchdogMin: 10,
    repeatGapS: 3,
    macros: defaultMacros().qso,
    set: 'qso',
    myCall: '9V1NE',
    myName: 'AMON',
    myQth: 'SINGAPORE',
    myGrid: 'OJ11',
    exchange: '599 {NR}',
    nextSerial: 42,
    serialDigits: 3,
    contestId: '',
    mode: 'RTTY',
    band: '20m',
    dialHz: 14_083_000,
    markHz: 1612,
    ...over,
  };
  const sent: string[] = [];
  const logged: LogQsoRecord[] = [];
  let finished = 0;
  let stopped = 0;
  let drained: (() => void) | null = null;
  let refuse: string | null = null;
  const s = new KeyboardSession({
    now: () => now,
    config: () => config,
    async startTx(cb) {
      if (refuse) return refuse;
      drained = cb.drained;
      return {
        text: (t) => sent.push(t),
        finish: () => finished++,
        stop: () => stopped++,
      };
    },
    async log(r) {
      logged.push(r);
      return true;
    },
    stepSerial() {
      config.nextSerial++;
    },
  });
  const settle = async () => {
    await Promise.resolve();
    await Promise.resolve();
    flushSync();
  };
  return {
    s,
    config,
    sent,
    logged,
    settle,
    get onAir() {
      return sent.join('');
    },
    get finished() {
      return finished;
    },
    get stopped() {
      return stopped;
    },
    refuse(text: string | null) {
      refuse = text;
    },
    /** The transmitter reports `queuedS` after a block. */
    report(queuedS: number) {
      s.txReport(queuedS);
    },
    drain() {
      drained?.();
    },
    advance(ms: number) {
      now += ms;
    },
  };
}

const macro = (label: string, set = defaultMacros().qso): Macro => set.find((m) => m.label === label)!;
const chars = (text: string, quality = 1): ModemEvent[] => [...text].map((ch) => ({ type: 'char', ch, snrDb: -5, quality, framingError: false }));

describe('typing', () => {
  it('never keys the radio by itself: typed text waits in the field', async () => {
    const r = rig();
    r.s.typed('cq de 9v1ne');
    await r.settle();
    expect(r.s.field).toBe('CQ DE 9V1NE');
    expect(r.s.tx).toBe('off');
    expect(r.sent).toEqual([]);
  });

  it('Return sends the line from receive and returns to receive when it is sent', async () => {
    const r = rig();
    r.s.typed('CQ DE 9V1NE');
    r.s.returnKey();
    await r.settle();
    expect(r.s.tx).toBe('ending');
    // A new line after the preamble, then 0.4 s of text: 3 characters.
    expect(r.sent).toEqual(['\n', 'CQ ']);
    expect(r.s.field).toBe('DE 9V1NE\n');
    for (let i = 0; i < 6; i++) r.report(0.1);
    expect(r.onAir).toBe('\nCQ DE 9V1NE\n');
    expect(r.s.field).toBe('');
    expect(r.finished).toBe(1);
    r.drain();
    expect(r.s.tx).toBe('off');
    expect(r.s.lines.filter((l) => l.kind === 'text').map((l) => l.text)).toEqual(['CQ DE 9V1NE', '']);
  });

  it('on air, Return adds a line break and keeps transmitting; typing goes out as it is typed', async () => {
    const r = rig();
    r.s.txButton();
    await r.settle();
    expect(r.s.tx).toBe('on');
    r.s.typed('HW CPY');
    r.report(0);
    expect(r.onAir).toBe('\nHW ');
    r.s.returnKey();
    r.report(0);
    r.report(0);
    expect(r.onAir).toBe('\nHW CPY\n');
    expect(r.s.tx).toBe('on');
    expect(r.finished).toBe(0);
  });

  it('holds at most 0.4 s in the transmitter, so backspace still reaches the rest', async () => {
    const r = rig({ newLineFirst: false });
    r.s.typed('TNX FER CALL');
    r.s.txButton();
    await r.settle();
    expect(r.onAir).toBe('TNX');
    expect(Math.ceil(TX_AHEAD_S / CHAR_S)).toBe(3);
    r.s.typed(r.s.field.slice(0, -5));
    expect(r.s.field).toBe(' FER');
    r.report(0.3);
    expect(r.onAir).toBe('TNX ');
  });

  it('skips characters the mode cannot send and says which', async () => {
    const r = rig({ newLineFirst: false });
    r.s.tables = { unsendable: '@%', otherCase: '' };
    r.s.typed('A@B%');
    r.s.txButton();
    await r.settle();
    r.report(0);
    expect(r.onAir).toBe('AB');
    expect(r.s.notice?.text).toBe('Not sent: @ %');
  });
});

describe('macros', () => {
  it('a tap from receive starts a transmission with the expanded text, and Return to Rx ends it after', async () => {
    const r = rig();
    r.s.setCall('JA1XYZ', false);
    r.s.tapMacro(macro('Answer'));
    await r.settle();
    expect(r.s.tx).toBe('ending');
    for (let i = 0; i < 20; i++) r.report(0);
    expect(r.onAir).toBe('\nJA1XYZ JA1XYZ DE 9V1NE 9V1NE 9V1NE K');
    expect(r.finished).toBe(1);
  });

  it('Over leaves the transmitter running, and a macro on air starts on a new line', async () => {
    const r = rig();
    r.s.setCall('JA1XYZ', false);
    r.s.tapMacro(macro('Over'));
    await r.settle();
    for (let i = 0; i < 10; i++) r.report(0);
    expect(r.s.tx).toBe('on');
    r.s.typed('GE');
    r.s.tapMacro(macro('BTU'));
    for (let i = 0; i < 20; i++) r.report(0);
    expect(r.onAir).toBe('\nJA1XYZ DE 9V1NEGE\nBTU JA1XYZ DE 9V1NE K');
    expect(r.finished).toBe(1);
  });

  it('adds nothing without a callsign to call, and says so', () => {
    const r = rig();
    r.s.tapMacro(macro('Answer'));
    expect(r.s.field).toBe('');
    expect(r.s.tx).toBe('off');
    expect(r.s.notice?.text).toBe('No callsign to call');
  });

  it('logs the strip once a Log QSO when sent macro has gone, and the serial steps on in the Contest set', async () => {
    const contest = defaultMacros().contest;
    const r = rig({ set: 'contest', macros: contest, contestId: 'CQ-WPX-RTTY' });
    r.s.setCall('OH2BAX', false);
    r.s.editField('rstRcvd', '599');
    r.s.editField('srx', '0877');
    r.s.tapMacro(macro('S&P exch', contest));
    await r.settle();
    for (let i = 0; i < 3; i++) r.report(0);
    expect(r.logged).toEqual([]);
    for (let i = 0; i < 10; i++) r.report(0);
    await r.settle();
    expect(r.onAir).toBe('\nTU 599 042 042');
    expect(r.logged).toHaveLength(1);
    expect(r.logged[0]).toMatchObject({ call: 'OH2BAX', mode: 'RTTY', reportSent: '599', reportRcvd: '599', stx: '042', srx: '0877', contestId: 'CQ-WPX-RTTY', dialHz: 14_083_000, audioHz: 1612, source: 'keyboard' });
    expect(r.config.nextSerial).toBe(43);
    expect(r.s.draft.fields.call).toBe('');
  });
});

describe('the QSO strip', () => {
  it('a tapped callsign fills name, QTH and report from that station text', async () => {
    const r = rig();
    r.s.receive(chars('CQ CQ DE JA1XYZ JA1XYZ PSE K\n'));
    r.advance(20_000);
    r.s.receive(chars('9V1NE DE JA1XYZ\nGE OM UR RST 579 579\nNAME TARO TARO QTH YOKOHAMA YOKOHAMA\n'));
    r.s.setCall('JA1XYZ');
    expect(r.s.draft.fields).toMatchObject({ call: 'JA1XYZ', rstSent: '599', rstRcvd: '579', name: 'TARO', qth: 'YOKOHAMA' });
    expect(r.s.draft.startMs).toBe(T);
    expect(r.s.notice?.text).toBe('Call set to JA1XYZ');
    // Text that arrives later fills what is still empty and keeps what the operator typed.
    r.s.editField('name', 'TARO-SAN');
    r.s.receive(chars('MY NAME IS TARO\n'));
    expect(r.s.draft.fields.name).toBe('TARO-SAN');
    expect(await r.s.logQso()).toBe(true);
    expect(r.logged[0]).toMatchObject({ name: 'TARO-SAN', qth: 'YOKOHAMA', stx: '', contestId: '' });
    expect(r.config.nextSerial).toBe(42);
  });

  it('Log QSO needs a callsign', async () => {
    const r = rig();
    expect(await r.s.logQso()).toBe(false);
    expect(r.s.notice?.text).toBe('No callsign to call');
  });
});

describe('receiving', () => {
  it('prints low-confidence characters as uncertain and drops characters while on air', async () => {
    const r = rig();
    r.s.receive(chars('AB'));
    r.s.receive(chars('C', 0.3));
    expect(r.s.lines.at(-1)).toMatchObject({ text: 'ABC', kinds: 'rru' });
    r.s.txButton();
    await r.settle();
    r.s.receive(chars('XYZ'));
    expect(r.s.lines.some((l) => l.text.includes('XYZ'))).toBe(false);
  });
});

describe('stopping', () => {
  it('Halt silences at once and keeps the text not yet sent', async () => {
    const r = rig({ newLineFirst: false });
    r.s.typed('TNX FER CALL');
    r.s.txButton();
    await r.settle();
    r.s.halt();
    expect(r.stopped).toBe(1);
    expect(r.s.tx).toBe('off');
    expect(r.s.field).toBe(' FER CALL');
  });

  it('ends a transmission that has sent only the idle signal for 1 min', async () => {
    const r = rig();
    r.s.txButton();
    await r.settle();
    r.advance(60_000);
    r.s.tick();
    expect(r.s.tx).toBe('on');
    r.advance(1_000);
    r.s.tick();
    expect(r.s.tx).toBe('ending');
    expect(r.finished).toBe(1);
    expect(r.s.notice?.text).toBe('Tx off after 1 min idle');
  });

  it('the watchdog stops Tx and Repeat CQ after 10 min with no key press, macro tap or Log QSO', async () => {
    const r = rig({ idleStopS: 0 });
    r.s.txButton();
    await r.settle();
    r.advance(9 * 60_000);
    r.s.typed('X');
    r.advance(9 * 60_000);
    r.s.tick();
    expect(r.s.tx).toBe('on');
    r.advance(60_000);
    r.s.tick();
    expect(r.s.tx).toBe('off');
    expect(r.stopped).toBe(1);
    expect(r.s.notice?.text).toBe('Watchdog stopped Tx after 10 min');
  });

  it('both limits can be Off', async () => {
    const r = rig({ idleStopS: 0, watchdogMin: 0 });
    r.s.txButton();
    await r.settle();
    r.advance(3 * 3_600_000);
    r.s.tick();
    expect(r.s.tx).toBe('on');
  });

  it('refuses to start without audio, and says why', async () => {
    const r = rig();
    r.refuse('Audio off');
    r.s.typed('CQ');
    r.s.returnKey();
    await r.settle();
    expect(r.s.tx).toBe('off');
    expect(r.s.notice?.text).toBe('Audio off');
    expect(r.s.field).toBe('CQ\n');
  });
});

describe('Repeat CQ', () => {
  it('sends CQ, listens for the gap, sends it again, and stops when a character prints', async () => {
    const r = rig();
    r.s.setRepeat(true);
    await r.settle();
    for (let i = 0; i < 30; i++) r.report(0);
    expect(r.onAir).toBe('\nCQ CQ CQ DE 9V1NE 9V1NE 9V1NE PSE K');
    r.drain();
    expect(r.s.repeat).toEqual({ on: true, nextAtMs: T + 3000 });
    r.advance(3000);
    r.s.tick();
    await r.settle();
    expect(r.s.tx).toBe('ending');
    for (let i = 0; i < 30; i++) r.report(0);
    r.drain();
    r.s.receive(chars('9V1NE DE JA1XYZ'));
    expect(r.s.repeat.on).toBe(false);
    r.advance(10_000);
    r.s.tick();
    expect(r.s.tx).toBe('off');
  });

  it('stops when the operator types or taps a macro, and on Halt', async () => {
    const r = rig();
    r.s.setRepeat(true);
    await r.settle();
    r.s.typed('X');
    expect(r.s.repeat.on).toBe(false);
    r.s.setRepeat(true);
    r.s.halt();
    expect(r.s.repeat.on).toBe(false);
  });
});
