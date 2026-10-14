import { describe, expect, it } from 'vitest';
import { bare, fieldOfReading, heard, isCallsign, otherReading, words } from './words';

describe('callsigns in received text', () => {
  it('takes the shapes of amateur callsigns with prefixes and suffixes', () => {
    for (const c of ['9V1NE', 'JA1XYZ', 'VK4TQ', 'BV2KQ', '4X1RF', '3DA0RU', 'E3TQ', 'VK3/9V1NE', '9V1NE/P', 'JA1XYZ/QRP', 'W1AW', 'K1A', 'dl5abc']) expect(isCallsign(c), c).toBe(true);
  });

  it('leaves out reports, abbreviations, power, radios and grids', () => {
    for (const w of ['599', '5NN', 'TU', 'QWU', '042', '100W', 'KX2', 'IC-7300', 'OJ11', 'OJ11VI', 'CQ', 'DE', '73', 'R']) expect(isCallsign(w), w).toBe(false);
  });

  it('needs the country table to place it, when there is one', () => {
    const table = (c: string) => c !== 'E3TQ';
    expect(isCallsign('JA1XYZ', table)).toBe(true);
    expect(isCallsign('E3TQ', table)).toBe(false);
  });

  it('splits on spaces and strips punctuation', () => {
    expect(words('CQ  DE JA1XYZ.').map((w) => w.word)).toEqual(['CQ', 'DE', 'JA1XYZ.']);
    expect(bare('BV2KQ.')).toBe('BV2KQ');
    expect(bare('(579,')).toBe('579');
  });
});

describe('what received text says', () => {
  it('reads name, QTH and report from a QSO over', () => {
    const over = ['9V1NE DE JA1XYZ', 'GE OM TNX FER CALL. UR RST 579 579', 'NAME TARO TARO QTH YOKOHAMA YOKOHAMA', 'HW CPY? 9V1NE DE JA1XYZ K'];
    expect(heard(over, false)).toEqual({ name: 'TARO', qth: 'YOKOHAMA', rst: '579' });
  });

  it('takes NAME IS, NAME HR IS, OP, QTH IS and two-word QTHs up to a full stop', () => {
    expect(heard(['MY NAME HR IS BOB ES QTH IS NEW YORK. RIG KX2'], false)).toEqual({ name: 'BOB', qth: 'NEW YORK' });
    expect(heard(['OP KEN QTH SINGAPORE SINGAPORE. RIG KX2'], false)).toEqual({ name: 'KEN', qth: 'SINGAPORE' });
  });

  it('reads a report after RST or UR only, outside a contest', () => {
    expect(heard(['599 TU'], false)).toEqual({});
    expect(heard(['UR 559 559'], false)).toEqual({ rst: '559' });
    expect(heard(['RST 509'], false)).toEqual({});
  });

  it('reads the report and serial number of a contest exchange', () => {
    expect(heard(['9V1NE 599 0877 0877'], true)).toEqual({ rst: '599', nr: '0877' });
    expect(heard(['DL5ABC 599 042 042 DL5ABC'], true)).toEqual({ rst: '599', nr: '042' });
  });

  it('never takes a word with an uncertain character, and the last mention wins', () => {
    expect(heard(['NAME T�RO'], false)).toEqual({});
    expect(heard(['NAME TARO', 'NAME KEN'], false)).toEqual({ name: 'KEN' });
  });
});

describe('the other-case reading', () => {
  // The US figures of the letters row Q to P, as rr73-rtty's other_case gives them.
  const read = (t: string) => [...t].map((c) => ({ Q: '1', W: '2', E: '3', R: '4', T: '5', Y: '6', U: '7', I: '8', O: '9', P: '0', '1': 'Q', '2': 'W', '7': 'U' })[c] ?? c).join('');

  it('reads letters as figures for a lost FIGS', () => {
    expect(otherReading('QWU', read)).toEqual({ text: '127', to: 'figures' });
    expect(otherReading('TOO', read)).toEqual({ text: '599', to: 'figures' });
    expect(fieldOfReading('599')).toBe('rstRcvd');
    expect(fieldOfReading('127')).toBe('srx');
  });

  it('reads figures as letters for a lost LTRS, and nothing for words that read the same or mixed', () => {
    expect(otherReading('127', read)).toEqual({ text: 'QWU', to: 'letters' });
    expect(otherReading('ABC', read)).toBeNull();
    expect(otherReading('TARO', read)).toBeNull();
  });
});
