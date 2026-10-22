import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SECTIONS, STATES, cqFormat, exchangeOn, readExchange, sentExchange, strength } from './exchange';

const ctx = { serial: 7, snrDb: -10, grid: 'OJ11ab' };

describe('readExchange', () => {
  it('finds class, section, state and the serial mark in any order and case', () => {
    expect(readExchange('6a wi')).toEqual({ fdClass: '6A', section: 'WI', state: 'WI', serial: false });
    expect(readExchange('EMA 12B')).toEqual({ fdClass: '12B', section: 'EMA', state: null, serial: false });
    expect(readExchange('#')).toEqual({ fdClass: null, section: null, state: null, serial: true });
    expect(readExchange('  PEI  # ')).toEqual({ fdClass: null, section: null, state: 'PEI', serial: true });
    expect(readExchange('06A DX')).toMatchObject({ fdClass: '6A', section: 'DX', state: null });
  });

  it('ignores classes the codec cannot send', () => {
    for (const t of ['33A WI', '0A WI', '6J WI', 'A6 WI']) expect(readExchange(t).fdClass, t).toBeNull();
  });
});

describe('sentExchange', () => {
  it('builds each format from the parts', () => {
    expect(sentExchange('fd', readExchange('6A WI'), ctx)).toEqual({ ok: { text: '6A WI', rst: '', stx: '6A WI', serial: null } });
    expect(sentExchange('ru', readExchange('6A WI'), ctx)).toEqual({ ok: { text: '579 WI', rst: '579', stx: 'WI', serial: null } });
    expect(sentExchange('ru', readExchange('#'), ctx)).toEqual({ ok: { text: '579 0007', rst: '579', stx: '0007', serial: 7 } });
    expect(sentExchange('vhf', readExchange('6A WI'), ctx)).toEqual({ ok: { text: '570007 OJ11AB', rst: '57', stx: '0007 OJ11AB', serial: 7 } });
  });

  it('prefers the state to the serial number for a report with either', () => {
    expect(sentExchange('ru', readExchange('WI #'), ctx)).toMatchObject({ ok: { text: '579 WI' } });
  });

  it('names what is missing', () => {
    expect(sentExchange('fd', readExchange('WI'), ctx)).toEqual({ missing: 'Exchange needs a class' });
    expect(sentExchange('fd', readExchange('6A'), ctx)).toEqual({ missing: 'Exchange needs a section' });
    expect(sentExchange('fd', readExchange('#'), ctx)).toEqual({ missing: 'Exchange needs class and section' });
    expect(sentExchange('ru', readExchange('6A EMA'), ctx)).toEqual({ missing: 'Exchange needs a state or serial' });
    expect(sentExchange('ru', readExchange('#'), { ...ctx, serial: 8000 })).toEqual({ missing: 'Serial number out of range' });
    expect(sentExchange('ru', readExchange('#'), { ...ctx, serial: 0 })).toEqual({ missing: 'Serial number out of range' });
    expect(sentExchange('vhf', readExchange('#'), { ...ctx, grid: 'OJ11' })).toEqual({ missing: 'Exchange needs a 6-character grid' });
    expect(sentExchange('vhf', readExchange('#'), { ...ctx, serial: 2048 })).toEqual({ missing: 'Serial number out of range' });
    expect(sentExchange('vhf', readExchange('#'), { ...ctx, serial: 0 })).toMatchObject({ ok: { text: '570000 OJ11AB' } });
  });
});

describe('the rest', () => {
  it('maps only CQ FD and CQ RU to a format', () => {
    expect(cqFormat('FD')).toBe('fd');
    expect(cqFormat('ru')).toBe('ru');
    for (const m of [null, 'TEST', 'DX', 'POTA', 'WW']) expect(cqFormat(m), String(m)).toBe('standard');
  });

  it('turns the formats on only with text', () => {
    expect([exchangeOn(''), exchangeOn('  '), exchangeOn(undefined), exchangeOn('#')]).toEqual([false, false, false, true]);
  });

  it('gives report digits from 2 to 9, 7 at -10 dB', () => {
    expect([-40, -30, -18, -10, -2, 20].map(strength)).toEqual([2, 2, 5, 7, 9, 9]);
  });

  it('holds the codec section and state lists', () => {
    const rust = readFileSync(new URL('../../../../crates/rr73-ft8/src/message/fields.rs', import.meta.url), 'utf8');
    const list = (name: string) => {
      const body = new RegExp(`const ${name}: \\[&str; \\d+\\] = \\[([^\\]]*)\\]`).exec(rust)?.[1] ?? '';
      return [...body.matchAll(/"([A-Z]+)"/g)].map((m) => m[1]);
    };
    expect(SECTIONS).toEqual(list('SECTIONS'));
    expect(STATES).toEqual(list('STATES'));
  });
});
