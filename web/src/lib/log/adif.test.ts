/*
 * ADIF reading and writing, with files written the way other loggers write them.
 *
 * wavelogRecord() models how Wavelog reads one record (application/libraries/Adif_parser.php,
 * record_to_array, at Wavelog commit 3af1ba5; that file is under the Apache License 2.0,
 * Copyright 2011 Jason Harris KJ4IWX). It is written here from its behaviour: a length is read
 * as characters first, and as UTF-8 bytes when the character count does not end on "<", white
 * space or the end of the record. It checks that Wavelog reads RR73's files as RR73 means them.
 */
import { describe, expect, it } from 'vitest';
import { ADIF_VERSION, adifField, adifTimestamp, parseAdif, utf8Length, writeAdif, writeRecord, type AdifRecord } from './adif';

const enc = new TextEncoder();
const dec = new TextDecoder();

function wavelogRecord(record: string): Record<string, string> {
  const chars = Array.from(record);
  const out: Record<string, string> = {};
  for (let a = 0; a < chars.length; a++) {
    if (chars[a] !== '<') continue;
    a++;
    let tag = '';
    while (a < chars.length && chars[a] !== ':') tag += chars[a++];
    if (a >= chars.length) break;
    a++;
    let lenStr = '';
    while (a < chars.length && chars[a] !== '>' && chars[a] !== ':') lenStr += chars[a++];
    if (!/^\d+$/.test(lenStr)) continue;
    const len = Number(lenStr);
    while (a < chars.length && chars[a] !== '>') a++;
    a++;
    const byteOffset = enc.encode(chars.slice(0, a).join('')).length;
    const bytes = enc.encode(record);
    let value: string;
    let consumed: number;
    if (a + len <= chars.length) {
      value = chars.slice(a, a + len).join('');
      consumed = len;
      const next = chars[a + len];
      if (next !== undefined && next !== '<' && !/\s/.test(next) && byteOffset + len <= bytes.length) {
        value = dec.decode(bytes.slice(byteOffset, byteOffset + len));
        consumed = Array.from(value).length;
      }
    } else if (byteOffset + len <= bytes.length) {
      value = dec.decode(bytes.slice(byteOffset, byteOffset + len));
      consumed = Array.from(value).length;
    } else break;
    a += consumed - 1;
    out[tag.toLowerCase()] = value.trimEnd();
  }
  return out;
}

/** Wavelog's /api/qso: the text after <EOH> (if any), split on <EOR>, each part read as a record. */
function wavelogRead(adif: string): Record<string, string>[] {
  const body = adif.includes('<EOH>') ? adif.split('<EOH>')[1] : adif;
  return body
    .split(/<eor>/i)
    .map(wavelogRecord)
    .filter((r) => r.call);
}

describe('writing ADIF', () => {
  it('counts field lengths in UTF-8 bytes', () => {
    expect(utf8Length('VK2ESN')).toBe(6);
    expect(utf8Length('Grüße aus Wien')).toBe(16);
    expect(utf8Length('東京')).toBe(6);
    expect(utf8Length('📻')).toBe(4);
    expect(adifField('comment', 'Grüße')).toBe('<COMMENT:7>Grüße');
  });

  it('writes the header RR73 promises', () => {
    const text = writeAdif([{ CALL: 'VK2ESN' }], { programVersion: '0.5.0', createdAt: Date.UTC(2026, 9, 13, 13, 14, 52) });
    const lines = text.split('\n');
    expect(lines[0]).toBe('ADIF export from RR73 0.5.0');
    expect(lines[0].startsWith('<')).toBe(false);
    expect(text).toContain(`<ADIF_VER:5>${ADIF_VERSION}`);
    expect(text).toContain('<PROGRAMID:4>RR73');
    expect(text).toContain('<PROGRAMVERSION:5>0.5.0');
    expect(text).toContain('<CREATED_TIMESTAMP:15>20261013 131452');
    expect(text).toContain('<EOH>');
    expect(text.trimEnd().endsWith('<CALL:6>VK2ESN <EOR>')).toBe(true);
    expect(adifTimestamp(Date.UTC(2026, 0, 2, 3, 4, 5))).toBe('20260102 030405');
  });

  it('keeps a header line that starts with "<" from reading as a field', () => {
    const text = writeAdif([], { programVersion: '1', createdAt: 0, headerText: '<b>log' });
    expect(text.startsWith('<')).toBe(false);
    expect(parseAdif(text).header.PROGRAMID).toBe('RR73');
  });

  it('leaves out empty fields and puts non-ASCII values last', () => {
    expect(writeRecord({ CALL: 'OE1XYZ', COMMENT: 'Grüße', GRIDSQUARE: '', BAND: '20m' })).toBe('<CALL:6>OE1XYZ <BAND:3>20m <COMMENT:7>Grüße <EOR>');
  });
});

describe('reading ADIF', () => {
  it('round-trips records, including non-ASCII text', () => {
    const records: AdifRecord[] = [
      { CALL: 'VK2ESN', QSO_DATE: '20261013', TIME_ON: '133200', BAND: '20m', MODE: 'FT8', RST_SENT: '-12', COMMENT: 'Grüße aus Wien' },
      { CALL: 'JA1KXM', MODE: 'MFSK', SUBMODE: 'FT4', COMMENT: '東京から 73', NAME: 'Tarō' },
      { CALL: '9M2TRX', COMMENT: 'Field day 📻 <3 > 2 dB' },
      { CALL: 'YB0AZK', COMMENT: 'a'.repeat(300) },
    ];
    const text = writeAdif(records, { programVersion: '0.5.0', createdAt: 0 });
    const back = parseAdif(text);
    expect(back.warnings).toEqual([]);
    expect(back.records).toEqual(records.map((r) => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== ''))));
    expect(back.header).toMatchObject({ ADIF_VER: ADIF_VERSION, PROGRAMID: 'RR73', PROGRAMVERSION: '0.5.0' });
    expect(back.headerText).toBe('ADIF export from RR73 0.5.0');
  });

  it('reads a WSJT-X log: lower-case names, a header line ending in <eoh>, no type indicators', () => {
    const wsjtx = [
      'WSJT-X ADIF Export<eoh>',
      '<call:6>VK2ESN <gridsquare:4>QF56 <mode:3>FT8 <rst_sent:3>-12 <rst_rcvd:3>-10 <qso_date:8>20261013 <time_on:6>133200 <qso_date_off:8>20261013 <time_off:6>133300 <band:3>20m <freq:9>14.075500 <station_callsign:5>9V1NE <my_gridsquare:6>OJ11xi <tx_pwr:1>5 <comment:9>FT8 Sent:  <eor>',
      '<call:6>JA1KXM <gridsquare:4>PM95 <mode:4>MFSK <submode:3>FT4 <rst_sent:3>-14 <rst_rcvd:3>-09 <qso_date:8>20261013 <time_on:6>131500 <band:3>20m <freq:9>14.081200 <eor>',
      '',
    ].join('\n');
    const f = parseAdif(wsjtx);
    expect(f.headerText).toBe('WSJT-X ADIF Export');
    expect(f.records).toHaveLength(2);
    expect(f.records[0]).toMatchObject({ CALL: 'VK2ESN', GRIDSQUARE: 'QF56', RST_SENT: '-12', FREQ: '14.075500', MY_GRIDSQUARE: 'OJ11xi', COMMENT: 'FT8 Sent:' });
    expect(f.records[1]).toMatchObject({ MODE: 'MFSK', SUBMODE: 'FT4' });
  });

  it('reads a header with fields, type indicators, CRLF, tabs and app-defined fields', () => {
    const log4om = [
      'ADIF Export from Log4OM <generated 2026-10-12>',
      '<ADIF_VER:5>3.1.0',
      '<PROGRAMID:6>LOG4OM <PROGRAMVERSION:6>1.47.0',
      '<USERDEF1:7:N>EPC_NUM',
      '<EOH>',
      '',
      '<CALL:6:S>DL1ABC\t<QSO_DATE:8:D>20261012   <TIME_ON:4:T>0930',
      '<BAND:3:E>40M <FREQ:8:N>7.074000 <MODE:3:E>FT8 <APP_LOG4OM_QSL:1>Y <EPC_NUM:4>1234 <EOR>',
      '',
    ].join('\r\n');
    const f = parseAdif(log4om);
    expect(f.header).toEqual({ ADIF_VER: '3.1.0', PROGRAMID: 'LOG4OM', PROGRAMVERSION: '1.47.0', USERDEF1: 'EPC_NUM' });
    expect(f.records).toEqual([{ CALL: 'DL1ABC', QSO_DATE: '20261012', TIME_ON: '0930', BAND: '40M', FREQ: '7.074000', MODE: 'FT8', APP_LOG4OM_QSL: 'Y', EPC_NUM: '1234' }]);
    expect(f.warnings).toEqual([]);
  });

  it('reads EOH and EOR in any case, and a file with no header', () => {
    expect(parseAdif('x <EoH> <CALL:3>K1A <eOr><CALL:3>K1B<EOR>').records).toEqual([{ CALL: 'K1A' }, { CALL: 'K1B' }]);
    const bare = parseAdif('<CALL:3>K1A <BAND:3>20m <EOR>\n<CALL:3>K1B <EOR>');
    expect(bare.headerText).toBe('');
    expect(bare.header).toEqual({});
    expect(bare.records.map((r) => r.CALL)).toEqual(['K1A', 'K1B']);
  });

  it('reads lengths counted in characters as well as bytes', () => {
    const chars = parseAdif('<CALL:6>OE1XYZ <NAME:6>Jürgen <QTH:4>Wien <EOR>');
    const bytes = parseAdif('<CALL:6>OE1XYZ <NAME:7>Jürgen <QTH:4>Wien <EOR>');
    expect(chars.records[0]).toEqual({ CALL: 'OE1XYZ', NAME: 'Jürgen', QTH: 'Wien' });
    expect(bytes.records[0]).toEqual({ CALL: 'OE1XYZ', NAME: 'Jürgen', QTH: 'Wien' });
    // Without a separator, only one reading ends on the next field.
    expect(parseAdif('<NAME:7>Jürgen<CALL:3>K1A<EOR>').records[0]).toEqual({ NAME: 'Jürgen', CALL: 'K1A' });
    expect(parseAdif('<NAME:6>Jürgen<CALL:3>K1A<EOR>').records[0]).toEqual({ NAME: 'Jürgen', CALL: 'K1A' });
  });

  it('keeps "<" and ">" inside a value, and empty fields', () => {
    expect(parseAdif('<COMMENT:12><3 from <K1> <CALL:3>K1A <NOTES:0> <EOR>').records[0]).toEqual({ COMMENT: '<3 from <K1>', CALL: 'K1A', NOTES: '' });
  });

  it('reads a BOM, and a last record without <EOR> with a warning', () => {
    const f = parseAdif('﻿<CALL:3>K1A <EOR> <CALL:3>K1B <BAND:3>20m');
    expect(f.records).toEqual([{ CALL: 'K1A' }, { CALL: 'K1B', BAND: '20m' }]);
    expect(f.warnings).toEqual(['The last record has no <EOR>; it was read anyway.']);
  });

  it('skips tags without a length and survives a truncated file', () => {
    const f = parseAdif('<CALL:3>K1A <BAD> <MODE:3>FT8 <EOR> <CALL:3>K1B <COMMENT:20>short');
    expect(f.records[0]).toEqual({ CALL: 'K1A', MODE: 'FT8' });
    expect(f.records[1]).toEqual({ CALL: 'K1B', COMMENT: 'short' });
    expect(f.warnings).toContain('Skipped "<BAD>": it has no length.');
    expect(f.warnings).toContain('COMMENT is shorter than its length of 20; kept what was there.');
    expect(parseAdif('<CALL:3>K1A <EOR> <MODE').warnings).toEqual(['The file ends inside a field name.']);
  });

  it('skips empty records', () => {
    expect(parseAdif('<EOH><EOR> <EOR><CALL:3>K1A<EOR>').records).toEqual([{ CALL: 'K1A' }]);
  });
});

describe('Wavelog reads what RR73 writes', () => {
  const comments = ['Grüße aus Wien', '73 de Ørsted', 'Привет из Москвы, спасибо за связь', '東京から 73、ありがとう', 'Two-fer 📻📻 at the summit', 'ñ'];
  for (const comment of comments) {
    it(`keeps "${comment}" and the fields around it`, () => {
      const rec: AdifRecord = { CALL: 'VK2ESN', BAND: '20m', NAME: 'José Müller', MODE: 'FT8', RST_SENT: '-12', COMMENT: comment };
      const adif = writeRecord(rec);
      const [got] = wavelogRead(adif);
      expect(got).toEqual({ call: 'VK2ESN', band: '20m', name: 'José Müller', mode: 'FT8', rst_sent: '-12', comment });
    });
  }

  it('reads a whole RR73 file as RR73 does', () => {
    const records: AdifRecord[] = [
      { CALL: 'OE1XYZ', BAND: '40m', COMMENT: 'Grüße' },
      { CALL: 'UA3ABC', BAND: '20m', COMMENT: 'Привет' },
    ];
    const text = writeAdif(records, { programVersion: '0.5.0', createdAt: 0 });
    expect(wavelogRead(text).map((r) => [r.call, r.band, r.comment])).toEqual([
      ['OE1XYZ', '40m', 'Grüße'],
      ['UA3ABC', '20m', 'Привет'],
    ]);
  });
});
