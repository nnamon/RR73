import { describe, expect, it } from 'vitest';
import { barText, huntText, runTally, steps, watchdogText } from './view';
import { Sim, decode } from '../testing/qso-sim';

const M = '−';

describe('bottom bar view', () => {
  it('shows the next message with its slot and second', () => {
    const s = new Sim();
    s.call(1, 'CQ JA1KXM PM95');
    expect(barText(s.st)).toBe('Tx1 · JA1KXM 9V1NE OJ11 · 1st · :30');
    s.call(1, 'CQ JA1KXM PM95', 2.5);
    expect(barText(s.st)).toBe('Tx1 · JA1KXM 9V1NE OJ11 · 1st · :00');
  });

  it('shows what is on air, then what it waits for', () => {
    const s = new Sim();
    s.call(1, 'CQ JA1KXM PM95');
    s.run(2, 2);
    expect(barText(s.st)).toBe('JA1KXM · waiting for a reply');
    s.hear(3, ['9V1NE JA1KXM -09']);
    expect(barText(s.st)).toBe('Tx3 · JA1KXM 9V1NE R-10 · 1st · :00');
  });

  it('says when the retries ran out, and is empty when idle', () => {
    const r = new Sim();
    expect(barText(r.st)).toBeNull();
    r.call(1, 'CQ JA1KXM PM95');
    r.run(2, 10);
    expect(barText(r.st)).toBe('Tx1 · JA1KXM 9V1NE OJ11 · no reply');
  });

  it('waits for callers after a CQ', () => {
    const s = new Sim();
    s.send({ type: 'callCq', nowMs: s.at(0, 0.1) });
    expect(barText(s.st)).toBe('Tx6 · CQ 9V1NE OJ11 · 1st · :00');
  });

  it('marks the steps of the exchange as they happen, the first with the grid our Tx1 sends', () => {
    const s = new Sim();
    s.call(1, 'CQ JA1KXM PM95');
    expect(steps(s.st).map((x) => `${x.label}:${x.state}`)).toEqual(['OJ11:now', 'Report:todo', 'R-report:todo', 'RR73:todo', '73:todo']);
    s.run(2, 4, { 3: ['9V1NE JA1KXM -09'] });
    expect(steps(s.st).map((x) => `${x.label}:${x.state}`)).toEqual(['OJ11:done', `${M}09:done`, `R${M}10:done`, 'RR73:now', '73:todo']);
  });

  it('names the first step Call when our Tx1 carries no grid', () => {
    const s = new Sim({ myGrid: '' });
    s.call(1, 'CQ JA1KXM PM95');
    expect(steps(s.st)[0].label).toBe('Call');
  });

  it('shows the calling side of the exchange', () => {
    const s = new Sim();
    s.send({ type: 'callCq', nowMs: s.at(0, 0.1) });
    s.run(0, 2, { 1: ['9V1NE K1ABC FN42'] });
    expect(steps(s.st).map((x) => `${x.label}:${x.state}`)).toEqual(['FN42:done', `${M}10:done`, 'R-report:now', 'RR73:todo', 'Logged:todo']);
  });

  it('counts down the watchdog, and says Tx off', () => {
    const s = new Sim();
    s.send({ type: 'callCq', nowMs: s.at(0, 0.1) });
    expect(watchdogText(s.st, s.at(1, 20.1))).toBe('Watchdog 5:25');
    s.send({ type: 'halt', nowMs: s.at(2) });
    expect(watchdogText(s.st, s.at(2))).toBe('Tx off');
  });

  it('says the watchdog is off', () => {
    const s = new Sim({ watchdogMs: 0 });
    s.send({ type: 'callCq', nowMs: s.at(0, 0.1) });
    expect(watchdogText(s.st, s.at(100))).toBe('Watchdog off');
  });

  it('says what Hunt is doing, with its tally', () => {
    const s = new Sim();
    expect(huntText(s.st)).toBeNull();
    s.send({ type: 'hunt', on: true, nowMs: s.at(0, 5) });
    expect(huntText(s.st)).toBe('Hunt · listening for CQs');
    s.hear(1, [decode('CQ VJ6X OF78', -12, 506)]);
    expect(huntText({ ...s.st, huntQsos: 2 })).toBe(`Hunt · calling VJ6X (${M}12 dB) · 2 QSOs`);
    s.run(2, 3, { 3: ['9V1NE VJ6X -09'] });
    expect(huntText({ ...s.st, huntQsos: 1 })).toBe('Hunt · working VJ6X · 1 QSO');
  });

  it('says who a lost station is working', () => {
    const s = new Sim();
    s.call(1, 'CQ VK2LAW QF56');
    s.run(2, 3, { 3: ['DV5CEL VK2LAW -05'] });
    expect(barText(s.st)).toBe('VK2LAW · working DV5CEL');
    const t = new Sim({ tailEnd: false });
    t.call(1, 'CQ VK2LAW QF56');
    t.run(2, 3, { 3: ['DV5CEL VK2LAW -05'] });
    expect(barText(t.st)).toBe('Tx1 · VK2LAW 9V1NE OJ11 · answered DV5CEL');
  });

  it('tallies Run once it has logged a QSO', () => {
    expect(runTally({ total: 0, hour: 0 })).toBeNull();
    expect(runTally({ total: 1, hour: 1 })).toBe('1 QSO · 1/h');
    expect(runTally({ total: 3, hour: 18 })).toBe('3 QSOs · 18/h');
  });
});
