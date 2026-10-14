import { describe, expect, it } from 'vitest';
import { changedCount, defaultMacros, expand, fieldsIn, normaliseMacros, queued, serialText, utc4, type FieldValues } from './macros';

const V: FieldValues = {
  MYCALL: '9V1NE',
  MYNAME: 'AMON',
  MYQTH: 'SINGAPORE',
  MYGRID: 'OJ11',
  CALL: 'JA1XYZ',
  NAME: 'TARO',
  QTH: 'YOKOHAMA',
  RST: '599',
  NR: '042',
  EXCH: '599 {NR}',
  UTC: '1405',
};

describe('macro expansion', () => {
  it('expands every field of the default QSO set', () => {
    const qso = defaultMacros().qso;
    const text = (label: string) => expand(qso.find((m) => m.label === label)!.text, V).text;
    expect(text('CQ')).toBe('CQ CQ CQ DE 9V1NE 9V1NE 9V1NE PSE K');
    expect(text('Answer')).toBe('JA1XYZ JA1XYZ DE 9V1NE 9V1NE 9V1NE K');
    expect(text('Report')).toBe('TNX FER CALL. UR RST 599 599. NAME AMON AMON QTH SINGAPORE SINGAPORE');
    expect(text('73')).toBe('TNX TARO 73 ES GL. JA1XYZ DE 9V1NE SK');
  });

  it('expands the exchange with its serial number', () => {
    const contest = defaultMacros().contest;
    expect(expand(contest.find((m) => m.label === 'Exch')!.text, V).text).toBe('JA1XYZ 599 042 042 JA1XYZ');
    expect(expand(contest.find((m) => m.label === 'S&P exch')!.text, V).text).toBe('TU 599 042 042');
    expect(expand('{UTC} {MYGRID}', V).text).toBe('1405 OJ11');
  });

  it('reports fields with no value, and closes the gap they leave', () => {
    const r = expand('TNX {NAME} 73. {CALL} DE {MYCALL}', { ...V, NAME: '', CALL: '' });
    expect(r.text).toBe('TNX 73. DE 9V1NE');
    expect(r.missing).toEqual(['NAME', 'CALL']);
    expect(expand('UR RST {RST} {RST}.', { ...V, RST: '' }).text).toBe('UR RST.');
    expect(expand('{NOPE} {CALL}', V).text).toBe('{NOPE} JA1XYZ');
  });

  it('reads a field in any case', () => {
    expect(expand('ur rst {rst} {Rst}', V).text).toBe('ur rst 599 599');
    expect(fieldsIn('{call} {CALL}')).toEqual(['CALL']);
  });

  it('lists the fields a macro holds, once each', () => {
    expect(fieldsIn('{CALL} {CALL} DE {MYCALL} {X}')).toEqual(['CALL', 'MYCALL']);
  });
});

describe('serial numbers', () => {
  it('pads to the digits set', () => {
    expect(serialText(42, 3)).toBe('042');
    expect(serialText(42, 1)).toBe('42');
    expect(serialText(7, 4)).toBe('0007');
    expect(serialText(1234, 3)).toBe('1234');
  });

  it('writes UTC as 4 digits', () => {
    expect(utc4(Date.UTC(2026, 9, 14, 9, 5, 59))).toBe('0905');
  });
});

describe('a macro on the queue', () => {
  it('starts on a new line unless its text starts with a space or the line is empty', () => {
    expect(queued('CQ CQ', false)).toBe('\nCQ CQ');
    expect(queued('CQ CQ', true)).toBe('CQ CQ');
    expect(queued(' BTU', false)).toBe(' BTU');
  });
});

describe('stored macro sets', () => {
  it('keeps valid macros and takes the defaults for a missing set', () => {
    const m = normaliseMacros({ qso: [{ id: 'x', label: 'Hello', text: 'HELLO', returnToRx: false, logWhenSent: true }, 'junk'] });
    expect(m.qso).toEqual([{ id: 'x', label: 'Hello', text: 'HELLO', returnToRx: false, logWhenSent: true }]);
    expect(m.contest).toEqual(defaultMacros().contest);
  });

  it('counts the macros that differ from the defaults', () => {
    const d = defaultMacros().qso;
    expect(changedCount(d, d)).toBe(0);
    const edited = [{ ...d[0], text: 'CQ' }, ...d.slice(1, 7), { id: 'new', label: 'New', text: '', returnToRx: true, logWhenSent: false }];
    expect(changedCount(edited, d)).toBe(3);
  });
});
