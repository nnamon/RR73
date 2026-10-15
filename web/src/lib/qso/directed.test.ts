import { describe, expect, it } from 'vitest';
import { answersDirected } from './directed';
import { DxccIndex } from '../reference/dxcc';

// Entities as the country file has them, trimmed to what these tests look up.
const CTY = DxccIndex.fromJson({
  format: 1,
  version: '2026-09-15',
  source: 'test',
  notice: 'MIT',
  entities: [
    { name: 'Singapore', prefix: '9V', wae: false, dxcc: 381, cq: 28, itu: 54, cont: 'AS', lat: 1.37, lon: 103.78, utc: 8, aliases: '9V S6' },
    { name: 'Japan', prefix: 'JA', wae: false, dxcc: 339, cq: 25, itu: 45, cont: 'AS', lat: 36.4, lon: 138.38, utc: 9, aliases: 'JA JE JH JR 7J' },
    { name: 'Australia', prefix: 'VK', wae: false, dxcc: 150, cq: 30, itu: 59, cont: 'OC', lat: -23.7, lon: 132.33, utc: 10, aliases: 'VK' },
    { name: 'Germany', prefix: 'DL', wae: false, dxcc: 230, cq: 14, itu: 28, cont: 'EU', lat: 51, lon: 10, utc: 1, aliases: 'DL DA DJ DK' },
    { name: 'Canary Islands', prefix: 'EA8', wae: false, dxcc: 29, cq: 33, itu: 36, cont: 'AF', lat: 28.32, lon: -15.85, utc: 0, aliases: 'EA8' },
  ],
});

describe('directed CQs', () => {
  it('answer an activity CQ whoever we are', () => {
    for (const m of ['POTA', 'SOTA', 'WWFF', 'IOTA', 'QRP', 'pota']) expect(answersDirected(m, 'JA1ABC', '9V1NE', CTY), m).toBe(true);
  });

  it('answer a continent CQ on our continent only', () => {
    expect(answersDirected('AS', 'JA1ABC', '9V1NE', CTY)).toBe(true);
    expect(answersDirected('EU', 'DL1ABC', '9V1NE', CTY)).toBe(false);
    expect(answersDirected('OC', 'VK2ABC', 'VK3/9V1NE', CTY)).toBe(true);
  });

  it('answer CQ DX from another continent only', () => {
    expect(answersDirected('DX', 'DL1ABC', '9V1NE', CTY)).toBe(true);
    expect(answersDirected('DX', 'JA1ABC', '9V1NE', CTY)).toBe(false);
    expect(answersDirected('DX', 'ZZ1ZZZ', '9V1NE', CTY)).toBe(false);
  });

  it('answer a prefix CQ in the entity it names', () => {
    expect(answersDirected('9V', 'JA1ABC', '9V1NE', CTY)).toBe(true);
    expect(answersDirected('JA', 'VK2ABC', '9V1NE', CTY)).toBe(false);
    expect(answersDirected('JA', 'VK2ABC', 'JH1XYZ', CTY)).toBe(true);
    expect(answersDirected('EA8', 'DL1ABC', 'EA8AB', CTY)).toBe(true);
  });

  it('skip contests, frequencies, unknown words and every CQ without the country file', () => {
    for (const m of ['TEST', 'WW', 'FD', 'RU', '290', 'XYZZY', 'Q1Q1Q'] as const) expect(answersDirected(m, 'DL1ABC', '9V1NE', CTY), m).toBe(false);
    expect(answersDirected('POTA', 'DL1ABC', '9V1NE', null)).toBe(false);
    expect(answersDirected('POTA', 'DL1ABC', '', CTY)).toBe(false);
  });

  it('need every word of the modifier', () => {
    expect(answersDirected('POTA DX', 'DL1ABC', '9V1NE', CTY)).toBe(true);
    expect(answersDirected('POTA EU', 'DL1ABC', '9V1NE', CTY)).toBe(false);
  });
});
