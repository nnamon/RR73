import { describe, expect, it } from 'vitest';
import { nextLine, statusLine, steps } from './view';
import { Sim } from '../testing/qso-sim';

const M = '−';

describe('dock view', () => {
  it('shows the next message, its start and its parity', () => {
    const s = new Sim();
    s.call(1, 'CQ JA1KXM PM95');
    expect(nextLine(s.st, s.at(2, 0.3))).toEqual({ title: 'Tx 1 · JA1KXM 9V1NE OJ11', detail: 'Starts 13:14:30 (1st)' });
  });

  it('says when a start is late, or too late for the slot', () => {
    const s = new Sim();
    s.call(1, 'CQ JA1KXM PM95', 1.0);
    expect(nextLine(s.st, s.at(2, 1))?.detail).toBe('Starts 13:14:31 (1st), 0.7 s late');
    s.call(1, 'CQ JA1KXM PM95', 2.5);
    expect(nextLine(s.st, s.at(2, 2.5))?.detail).toBe('Too late for :30, starts :00');
  });

  it('says what it waits for and when the reply would start', () => {
    const s = new Sim();
    s.call(1, 'CQ JA1KXM PM95');
    s.run(2, 2);
    expect(nextLine(s.st, s.at(3, 1))).toEqual({ title: 'Tx 3 · JA1KXM 9V1NE R-10', detail: "Starts 13:15:00 once JA1KXM's report is decoded" });
    s.run(3, 4, { 3: ['9V1NE JA1KXM -09'] });
    expect(nextLine(s.st, s.at(5, 1))).toEqual({ title: 'Tx 5 · JA1KXM 9V1NE 73', detail: 'Starts 13:15:30 once RR73 is decoded' });
  });

  it('asks for Enable Tx when Tx is off, and for a new call after the retries', () => {
    const s = new Sim();
    s.call(1, 'CQ JA1KXM PM95');
    s.send({ type: 'enableTx', on: false, nowMs: s.at(2, 0.35) });
    expect(nextLine(s.st, s.at(2, 0.4))?.detail).toBe('Enable Tx to send it at 13:14:30');
    const r = new Sim();
    r.call(1, 'CQ JA1KXM PM95');
    r.run(2, 10);
    expect(nextLine(r.st, r.at(11))?.detail).toBe('No reply after 3 repeats. Tap Call to try again.');
  });

  it('marks the steps of the exchange as they happen', () => {
    const s = new Sim();
    s.call(1, 'CQ JA1KXM PM95');
    expect(steps(s.st).map((x) => `${x.label}:${x.state}`)).toEqual(['Grid:now', 'Report:todo', 'R-report:todo', 'RR73:todo', '73:todo']);
    s.run(2, 4, { 3: ['9V1NE JA1KXM -09'] });
    expect(steps(s.st).map((x) => `${x.label}:${x.state}`)).toEqual(['Grid:done', `${M}09:done`, `R${M}10:done`, 'RR73:now', '73:todo']);
  });

  it('shows the calling side of the exchange', () => {
    const s = new Sim();
    s.send({ type: 'callCq', nowMs: s.at(0, 0.1) });
    s.run(0, 2, { 1: ['9V1NE K1ABC FN42'] });
    expect(steps(s.st).map((x) => `${x.label}:${x.state}`)).toEqual(['FN42:done', `${M}10:done`, 'R-report:now', 'RR73:todo', 'Logged:todo']);
  });

  it('writes the status line with the watchdog countdown', () => {
    const s = new Sim();
    s.send({ type: 'callCq', nowMs: s.at(0, 0.1) });
    expect(statusLine(s.st, s.at(1, 20.1))).toBe('Auto Seq on · Hold Tx 1500 Hz · Watchdog 5:25');
    s.send({ type: 'halt', nowMs: s.at(2) });
    expect(statusLine(s.st, s.at(2))).toBe('Auto Seq on · Hold Tx 1500 Hz · Tx off');
    expect(statusLine(s.st, s.at(2), false)).toBe('Auto Seq on · Tx 1500 Hz · Tx off');
  });
});
