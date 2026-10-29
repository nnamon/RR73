import { describe, expect, it } from 'vitest';
import { baseCall, looksLikeCall, markDecode, splitKey } from './marking';

const d = (text: string) => ({ text, freq_hz: 1500, dt_s: 0.1, snr_db: -10 });

describe('looksLikeCall', () => {
  it('accepts callsigns and hashed calls and rejects CQ modifiers and reports', () => {
    for (const c of ['9V1NE', 'JA1KXM', 'VK3/9V1NE', 'W7QRP/P', '<PJ4/K1ABC>', '3D2KQ']) expect(looksLikeCall(c), c).toBe(true);
    for (const c of ['CQ', 'POTA', 'DX', '73', '-09', 'R-14', '290']) expect(looksLikeCall(c), c).toBe(false);
    // Grid squares and RR73 are not callsigns.
    for (const c of ['QF22', 'OJ02', 'RR73', 'AA00']) expect(looksLikeCall(c), c).toBe(false);
  });
});

describe('baseCall', () => {
  it('strips portable prefixes and suffixes', () => {
    expect(baseCall('VK3/9V1NE')).toBe('9V1NE');
    expect(baseCall('W7QRP/P')).toBe('W7QRP');
    expect(baseCall('<PJ4/K1ABC>')).toBe('K1ABC');
    expect(baseCall('9V1NE')).toBe('9V1NE');
  });
});

describe('markDecode', () => {
  it('marks CQ calls with the caller in bold, past any modifier', () => {
    expect(markDecode(d('CQ 9M2TRX OJ02'), '9V1NE')).toEqual({ mark: 'cq', key: '9M2TRX' });
    expect(markDecode(d('CQ POTA VK3QRP QF22'), '9V1NE')).toEqual({ mark: 'cq', key: 'VK3QRP' });
    expect(markDecode(d('CQ DX 3D2KQ RH91'), '')).toEqual({ mark: 'cq', key: '3D2KQ' });
  });

  it('marks messages to my callsign with the sender in bold', () => {
    expect(markDecode(d('9V1NE JA1KXM -09'), '9V1NE')).toEqual({ mark: 'me', key: 'JA1KXM' });
    expect(markDecode(d('9V1NE JA1KXM RR73'), '9v1ne')).toEqual({ mark: 'me', key: 'JA1KXM' });
    expect(markDecode(d('9V1NE JA1KXM -09'), 'VK3/9V1NE')).toEqual({ mark: 'me', key: 'JA1KXM' });
  });

  it('marks any message containing my callsign, with the other station in bold', () => {
    expect(markDecode(d('JA1KXM 9V1NE R-14'), '9V1NE')).toEqual({ mark: 'me', key: 'JA1KXM' });
    expect(markDecode(d('<JA1KXM> 9V1NE RR73'), '9V1NE')).toEqual({ mark: 'me', key: '<JA1KXM>' });
    // My own CQ heard back is still mine.
    expect(markDecode(d('CQ 9V1NE OJ11'), '9V1NE')).toEqual({ mark: 'me', key: null });
    // A grid that looks like a callsign is not mine.
    expect(markDecode(d('CQ K1ABC FN42'), 'FN42')).toEqual({ mark: 'cq', key: 'K1ABC' });
  });

  it('marks LQ8 multi-station messages to me with their sender in bold', () => {
    expect(markDecode(d('<OE3OGC> R+05 <9V1NE> R-03 <AB4SS>'), '9V1NE')).toEqual({ mark: 'me', key: '<AB4SS>' });
    expect(markDecode(d('<9V1NE> R-03 <AB4SS>'), '9V1NE')).toEqual({ mark: 'me', key: '<AB4SS>' });
    expect(markDecode(d('<9V1NE> <OE3OGC> <...> 73'), '9V1NE')).toEqual({ mark: 'me', key: '<...>' });
    expect(markDecode(d('<OE3OGC> R+05 <9V1DE> R-03 <AB4SS>'), '9V1NE')).toEqual({ mark: null, key: null });
    // The LQ8 call: my callsign, then the caller.
    expect(markDecode(d('9V1NE AB4SS FN42 -03'), '9V1NE')).toEqual({ mark: 'me', key: 'AB4SS' });
  });

  it('leaves other traffic unmarked, and everything when no callsign is set', () => {
    expect(markDecode(d('JH1RRT YB0AZK RR73'), '9V1NE')).toEqual({ mark: null, key: null });
    expect(markDecode(d('9V1NE JA1KXM -09'), '')).toEqual({ mark: null, key: null });
  });

  it('marks what I sent with the other station in bold', () => {
    expect(markDecode(d('JA1KXM 9V1NE R-14'), '9V1NE', true)).toEqual({ mark: 'sent', key: 'JA1KXM' });
  });
});

describe('splitKey', () => {
  it('splits around the whole-word key', () => {
    expect(splitKey('CQ POTA VK3QRP QF22', 'VK3QRP')).toEqual({ before: 'CQ POTA ', bold: 'VK3QRP', after: ' QF22' });
    expect(splitKey('VK3QRPX VK3QRP', 'VK3QRP')).toEqual({ before: 'VK3QRPX ', bold: 'VK3QRP', after: '' });
    expect(splitKey('CQ DX', null)).toEqual({ before: 'CQ DX', bold: '', after: '' });
    expect(splitKey('CQ DX', 'K1ABC')).toEqual({ before: 'CQ DX', bold: '', after: '' });
  });
});
