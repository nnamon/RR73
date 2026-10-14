import { describe, expect, it } from 'vitest';
import { CtyFormatError, parseAlias, parseCtyCsvCodes, parseCtyDat, toCtyJson } from './cty';
import { readCtyJson } from './format';

// Verbatim records from Big CTY 15 September 2026 (cty.dat, CRLF line ends). Records cut short
// end with "..." in the comment and a ";" added after the last alias kept.
const SMOM_FIJI_ROTUMA = [
  'Sov Mil Order of Malta:   15:  28:  EU:   41.90:   -12.43:    -1.0:  1A:',
  '    1A;',
  'Fiji:                     32:  56:  OC:  -17.78:  -177.92:   -12.0:  3D2:',
  '    3D2,=3D5X;',
  'Conway Reef:              32:  56:  OC:  -22.00:  -175.00:   -12.0:  3D2/c:',
  '    =3D20CR,=3D2C,=3D2CCC,=3D2CI,=3D2CR,=3D2CY;',
  'Rotuma Island:            32:  56:  OC:  -12.48:  -177.08:   -12.0:  3D2/r:',
  '    =3D22,=3D2AG/P,=3D2EU,=3D2GC/P,=3D2HY/R,=3D2NV/P,=3D2NV/R,=3D2R,=3D2RA,=3D2RAT,=3D2RI,=3D2RO,',
  '    =3D2RR,=3D2RRR,=3D2RX,=3D2V,=3D2VB/R,=3D2Y,=VERSION;',
  '',
].join('\r\n');

// Vienna Intl Ctr (complete), Sicily (cut after its first alias line ...), Chatham Islands.
const WAE = [
  'Vienna Intl Ctr:          15:  28:  EU:   48.20:   -16.30:    -1.0:  *4U1V:',
  '    =4U0IARU,=4U0R,=4U100QO,=4U10NPT,=4U18FIFA,=4U1A,=4U1VIC,=4U1WED,=4U1XMAS,=4U2STAYHOME,=4U2U,',
  '    =4U30VIC,=4U500M,=4U70VIC,=4U75A,=4UNR,=4Y1A,=C7A;',
  'Sicily:                   15:  28:  EU:   37.50:   -14.00:    -1.0:  *IT9:',
  '    IB9,ID9,IE9,IF9,II9,IJ9,IO9,IP9,IQ9,IR9,IT9,IU9,IW9,IY9,=II0GDF/9,=II0OGB,=II1MM/9,=II1RT/9;',
  'Chatham Islands:          32:  60:  OC:  -43.85:   176.48:  -12.75:  ZL7:',
  '    ZL7,ZM7;',
].join('\r\n');

// Australia and Asiatic Russia, each cut after its first alias line (...): zone overrides.
const ZONES = [
  'Australia:                30:  59:  OC:  -23.70:  -132.33:   -10.0:  VK:',
  '    AX,VI,VJ,VK,VL,=VK90ABC,=VK90AR,=VK9MAV,',
  '    =VK6MB/1;',
  'Asiatic Russia:           17:  30:  AS:   55.88:   -84.08:    -7.0:  UA9:',
  '    UF9,UG0(19)[33],UG8,UG9,UH0(19)[33],UH8,UH9,UI0(19)[33],UI8,UI9,=R0FK(40)[75],=R0FK/P(40),',
  '    =R0FK/POLE(40),=R0PA(40)[75];',
].join('\r\n');

describe('parseCtyDat', () => {
  it('reads headers in usual signs: east positive, hours east of UTC', () => {
    const [smom, fiji, conway, rotuma] = parseCtyDat(SMOM_FIJI_ROTUMA);
    expect(smom).toEqual({ name: 'Sov Mil Order of Malta', prefix: '1A', wae: false, cq: 15, itu: 28, cont: 'EU', lat: 41.9, lon: 12.43, utc: 1, tokens: ['1A'] });
    expect([fiji.lat, fiji.lon, fiji.utc]).toEqual([-17.78, 177.92, 12]);
    expect(conway.prefix).toBe('3D2/c');
    expect(rotuma.tokens).toHaveLength(19);
    expect(rotuma.tokens.slice(0, 2)).toEqual(['=3D22', '=3D2AG/P']);
    expect(rotuma.tokens.at(-1)).toBe('=VERSION');
  });

  it('marks WAE entities and keeps aliases across lines in file order', () => {
    const [vic, sicily, chatham] = parseCtyDat(WAE);
    expect([vic.prefix, vic.wae, sicily.prefix, sicily.wae, chatham.wae]).toEqual(['4U1V', true, 'IT9', true, false]);
    expect(vic.tokens).toHaveLength(18);
    expect(sicily.tokens.slice(13, 15)).toEqual(['IY9', '=II0GDF/9']);
    expect([chatham.lon, chatham.utc]).toEqual([-176.48, 12.75]);
  });

  it('keeps zone overrides in the alias tokens', () => {
    const [vk, ua9] = parseCtyDat(ZONES);
    expect(vk.tokens).toEqual(['AX', 'VI', 'VJ', 'VK', 'VL', '=VK90ABC', '=VK90AR', '=VK9MAV', '=VK6MB/1']);
    expect(ua9.tokens).toContain('=R0FK(40)[75]');
    expect(ua9.tokens).toContain('UG0(19)[33]');
  });

  it('refuses malformed records with a line number', () => {
    expect(() => parseCtyDat('')).toThrow(CtyFormatError);
    expect(() => parseCtyDat(`${SMOM_FIJI_ROTUMA}Bad:   1:  2:  EU:  1.0:\r\n    X;`)).toThrow(/line 10 has fewer than 8 header fields/);
    expect(() => parseCtyDat('Nowhere: 1: 2: XX: 0: 0: 0: Q:\n Q;')).toThrow(/unknown continent "XX"/);
    expect(() => parseCtyDat('Nowhere: 1: x: EU: 0: 0: 0: Q:\n Q;')).toThrow(/malformed header/);
    expect(() => parseCtyDat('Nowhere: 1: 2: EU: 0: 0: 0: Q:\n Q,K1#X;')).toThrow(/line 1: Alias "K1#X" is not in cty.dat syntax/);
  });
});

describe('parseAlias', () => {
  it('reads exact calls, prefixes and zone overrides', () => {
    expect(parseAlias('KH6')).toEqual({ text: 'KH6', exact: false });
    expect(parseAlias('=3D2AG/P')).toEqual({ text: '3D2AG/P', exact: true });
    expect(parseAlias('=R0FK(40)[75]')).toEqual({ text: 'R0FK', exact: true, cq: 40, itu: 75 });
    expect(parseAlias('UG0(19)[33]')).toEqual({ text: 'UG0', exact: false, cq: 19, itu: 33 });
    expect(parseAlias('=LW7DQQ/Y[16]')).toEqual({ text: 'LW7DQQ/Y', exact: true, itu: 16 });
  });

  // Big CTY of 15 September 2026 uses no position, continent or time overrides; these tokens follow
  // the format page (https://www.country-files.com/cty-dat-format/).
  it('reads position, continent and time overrides in cty.dat signs', () => {
    expect(parseAlias('IG9<36.0/-12.5>{AF}~-1.0~')).toEqual({ text: 'IG9', exact: false, lat: 36, lon: 12.5, cont: 'AF', utc: 1 });
    expect(parseAlias('=TA1ABC{EU}(20)')).toEqual({ text: 'TA1ABC', exact: true, cont: 'EU', cq: 20 });
    expect(() => parseAlias('K1ABC{XX}')).toThrow(/unknown continent/);
    expect(() => parseAlias('K1(5')).toThrow(CtyFormatError);
  });
});

describe('cty.csv codes and cty.json', () => {
  // Verbatim lines from cty.csv of the same release, alias column cut.
  const CSV = '1A,Sov Mil Order of Malta,246,EU,15,28,41.90,-12.43,-1.0,1A;\r\n*4U1V,Vienna Intl Ctr,206,EU,15,28,48.20,-16.30,-1.0,=4U0IARU;\r\n';

  it('maps primary prefixes, without the WAE star, to DXCC codes', () => {
    expect([...parseCtyCsvCodes(CSV)]).toEqual([
      ['1A', 246],
      ['4U1V', 206],
    ]);
    expect(() => parseCtyCsvCodes('1A,Name,abc\n')).toThrow(/no DXCC code/);
  });

  it('builds cty.json that the reader accepts, with null codes where cty.csv has none', () => {
    const json = toCtyJson(parseCtyDat(SMOM_FIJI_ROTUMA), parseCtyCsvCodes(CSV), { version: '2026-09-15', source: 'test', notice: 'MIT' });
    const back = readCtyJson(JSON.parse(JSON.stringify(json)));
    expect(back.entities.map((e) => [e.prefix, e.dxcc])).toEqual([
      ['1A', 246],
      ['3D2', null],
      ['3D2/c', null],
      ['3D2/r', null],
    ]);
    expect(back.entities[3].aliases.split(' ')).toHaveLength(19);
  });
});
