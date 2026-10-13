import { describe, expect, it } from 'vitest';
import { buildMessages, formatReport, isGrid, parseExchange, sameCall } from './messages';
import { gridCentre, pathBetween } from './grid';

describe('parseExchange', () => {
  it('reads CQ calls with and without a modifier or grid', () => {
    expect(parseExchange('CQ JA1KXM PM95')).toEqual({ to: null, from: 'JA1KXM', kind: 'cq', grid: 'PM95', report: null, modifier: null });
    expect(parseExchange('CQ POTA VK3QRP QF22')).toMatchObject({ kind: 'cq', from: 'VK3QRP', modifier: 'POTA', grid: 'QF22' });
    expect(parseExchange('CQ DX 3D2KQ')).toMatchObject({ kind: 'cq', from: '3D2KQ', modifier: 'DX', grid: null });
  });

  it('reads each step of the exchange', () => {
    expect(parseExchange('9V1NE JA1KXM PM95')).toMatchObject({ to: '9V1NE', from: 'JA1KXM', kind: 'grid', grid: 'PM95' });
    expect(parseExchange('9V1NE JA1KXM -09')).toMatchObject({ kind: 'report', report: -9 });
    expect(parseExchange('9V1NE JA1KXM +05')).toMatchObject({ kind: 'report', report: 5 });
    expect(parseExchange('9V1NE JA1KXM R-14')).toMatchObject({ kind: 'rreport', report: -14 });
    expect(parseExchange('9V1NE JA1KXM RRR')).toMatchObject({ kind: 'rrr' });
    expect(parseExchange('9V1NE JA1KXM RR73')).toMatchObject({ kind: 'rr73', grid: null });
    expect(parseExchange('9V1NE JA1KXM 73')).toMatchObject({ kind: '73' });
    expect(parseExchange('9V1NE JA1KXM')).toMatchObject({ kind: 'call' });
    expect(parseExchange('<PJ4/K1ABC> 9V1NE -12')).toMatchObject({ to: '<PJ4/K1ABC>', from: '9V1NE', kind: 'report' });
  });

  it('calls anything else other', () => {
    for (const t of ['TNX FER QSO', 'CQ', 'K1ABC W9XYZ 579 0013', 'CQ K1ABC FN42 EXTRA', '']) expect(parseExchange(t).kind, t).toBe('other');
  });
});

describe('formatReport', () => {
  it('rounds, clamps and signs reports as sent on air', () => {
    expect(formatReport(-9.4)).toBe('-09');
    expect(formatReport(-14)).toBe('-14');
    expect(formatReport(3)).toBe('+03');
    expect(formatReport(0)).toBe('+00');
    expect(formatReport(-60)).toBe('-50');
    expect(formatReport(55)).toBe('+49');
  });
});

describe('buildMessages', () => {
  it('builds Tx1 to Tx6', () => {
    expect(buildMessages({ dx: 'JA1KXM', me: '9V1NE', grid: 'OJ11ab', report: -14, ack: 'RR73', cqModifier: null })).toEqual({
      1: 'JA1KXM 9V1NE OJ11',
      2: 'JA1KXM 9V1NE -14',
      3: 'JA1KXM 9V1NE R-14',
      4: 'JA1KXM 9V1NE RR73',
      5: 'JA1KXM 9V1NE 73',
      6: 'CQ 9V1NE OJ11',
    });
  });

  it('leaves partner messages empty without a partner, and adds the CQ modifier', () => {
    const m = buildMessages({ dx: null, me: '9V1NE', grid: 'OJ11', report: null, ack: 'RRR', cqModifier: 'pota' });
    expect(m[1]).toBe('');
    expect(m[6]).toBe('CQ POTA 9V1NE OJ11');
    expect(buildMessages({ dx: 'K1ABC', me: '9V1NE', grid: 'OJ11', report: -3, ack: 'RRR', cqModifier: null })[4]).toBe('K1ABC 9V1NE RRR');
  });
});

describe('callsigns and grids', () => {
  it('matches stations across portable prefixes and hash brackets', () => {
    expect(sameCall('VK3/9V1NE', '9v1ne')).toBe(true);
    expect(sameCall('<JA1KXM>', 'JA1KXM')).toBe(true);
    expect(sameCall('JA1KXM', 'JA1KXN')).toBe(false);
    expect(sameCall(null, 'JA1KXM')).toBe(false);
  });

  it('checks grid squares', () => {
    expect(['OJ11', 'oj11ab', 'PM95'].every(isGrid)).toBe(true);
    expect(['OJ1', 'SJ11', 'OJ11ZZ', 'RR73x'].some(isGrid)).toBe(false);
  });

  it('finds grid centres, distances and bearings', () => {
    expect(gridCentre('OJ11')).toEqual({ lat: 1.5, lon: 103 });
    expect(gridCentre('JJ00aa')!.lat).toBeCloseTo(0.0208, 3);
    // Singapore to Tokyo, about 5300 km north-east.
    const p = pathBetween('OJ11', 'PM95')!;
    expect(p.km).toBeGreaterThan(5100);
    expect(p.km).toBeLessThan(5500);
    expect(p.bearing).toBeGreaterThan(20);
    expect(p.bearing).toBeLessThan(50);
    expect(pathBetween('OJ11', 'nope')).toBeNull();
  });
});
