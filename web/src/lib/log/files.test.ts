import { describe, expect, it, vi } from 'vitest';
import { parseAdif } from './adif';
import { buildExport, buildPartFile, dayText, shareFile, type ExportFile } from './files';
import { createQso } from './qso';
import type { Activation, Qso } from './types';

const DAY1 = Date.UTC(2026, 9, 13, 18, 0, 0);
const DAY2 = Date.UTC(2026, 9, 14, 0, 30, 0);
const OPTS = { programVersion: '0.5.0', now: Date.UTC(2026, 9, 15, 9, 0, 0) };

const ACT: Activation = {
  id: 'act1',
  refs: [
    { programme: 'POTA', ref: 'VK-0921' },
    { programme: 'POTA', ref: 'VK-0922' },
    { programme: 'SOTA', ref: 'VK3/VC-012' },
    { programme: 'WWFF', ref: 'VKFF-0921' },
  ],
  callsign: 'VK3/9V1NE',
  operator: '9V1NE',
  grid: 'QF22lb',
  gridSource: 'gps',
  wavelogStationId: null,
  startedAt: DAY1,
  endedAt: null,
  updatedAt: DAY1,
};

let n = 0;
const q = (call: string, at: number, a: Activation | null = ACT): Qso =>
  createQso({ call, mode: 'FT8', band: '20m', dialHz: 14_074_000, audioHz: 1500, startUtcMs: at, endUtcMs: at + 45_000, reportSent: -10, reportRcvd: -12 }, { id: `00000000-0000-4000-8000-00000000000${++n}`, now: at, activation: a, callsign: '9V1NE' });

const QSOS = [q('ZL1TQK', DAY1 + 600_000), q('VK2ESN', DAY1), q('JH1RRT', DAY2), { ...q('VK9XX', DAY1 + 60_000), deletedAt: DAY1 + 70_000 }, q('W1AW', DAY1, null)];

describe('programme files', () => {
  it('makes one POTA file per park and UTC day, with that park in MY_SIG_INFO', () => {
    const f = buildPartFile('pota|VK-0922|20261013', QSOS, ACT, OPTS)!;
    expect(f.name).toBe('VK3-9V1NE@VK-0922-20261013.adi');
    const adif = parseAdif(f.text);
    expect(adif.headerText).toBe('POTA log for VK-0922 on 13 Oct 2026, made by RR73 0.5.0');
    expect(adif.header).toMatchObject({ ADIF_VER: '3.1.4', PROGRAMID: 'RR73', PROGRAMVERSION: '0.5.0', CREATED_TIMESTAMP: '20261015 090000' });
    expect(adif.records.map((r) => r.CALL)).toEqual(['VK2ESN', 'ZL1TQK']);
    expect(adif.records[0]).toMatchObject({ STATION_CALLSIGN: 'VK3/9V1NE', OPERATOR: '9V1NE', MY_SIG: 'POTA', MY_SIG_INFO: 'VK-0922', MY_POTA_REF: 'VK-0922', MY_SOTA_REF: 'VK3/VC-012', MY_GRIDSQUARE: 'QF22lb' });
    expect(adif.records[0].APP_RR73_ID).toBeUndefined();
    expect(buildPartFile('pota|VK-0921|20261014', QSOS, ACT, OPTS)?.name).toBe('VK3-9V1NE@VK-0921-20261014.adi');
  });

  it('writes LQ8 as MFSK with no submode in a POTA file only', () => {
    const lq8 = { ...q('OE3OGC', DAY1), ...{ mode: 'DATA', submode: 'LQ8' } };
    const pota = parseAdif(buildPartFile('pota|VK-0922|20261013', [lq8], ACT, OPTS)!.text).records[0];
    expect(pota.MODE).toBe('MFSK');
    expect(pota.SUBMODE).toBeUndefined();
    const sota = parseAdif(buildPartFile('sota|VK3/VC-012|20261013', [lq8], ACT, OPTS)!.text).records[0];
    expect(sota).toMatchObject({ MODE: 'DATA', SUBMODE: 'LQ8' });
  });

  it('makes a SOTA file per summit and UTC day', () => {
    const f = buildPartFile('sota|VK3/VC-012|20261014', QSOS, ACT, OPTS)!;
    expect(f.name).toBe('VK3-9V1NE@VK3-VC-012-20261014.adi');
    expect(parseAdif(f.text).records.map((r) => [r.CALL, r.MY_SOTA_REF])).toEqual([['JH1RRT', 'VK3/VC-012']]);
  });

  it('makes a WWFF file per reference and activation, named as WWFF asks', () => {
    const f = buildPartFile('wwff|VKFF-0921|act1', QSOS, ACT, OPTS)!;
    expect(f.name).toBe('VK3-9V1NE@VKFF-0921 20261013.adi');
    const recs = parseAdif(f.text).records;
    expect(recs.map((r) => r.CALL)).toEqual(['VK2ESN', 'ZL1TQK', 'JH1RRT']);
    expect(recs[0]).toMatchObject({ MY_WWFF_REF: 'VKFF-0921', MY_SIG: 'WWFF', MY_SIG_INFO: 'VKFF-0921' });
  });

  it('makes an ADIF file per activation with RR73 ids', () => {
    const f = buildPartFile('adif|act1', QSOS, ACT, OPTS)!;
    expect(f.name).toBe('VK3-9V1NE 20261013 VK-0921 VK-0922 VK3-VC-012 VKFF-0921.adi');
    const recs = parseAdif(f.text).records;
    expect(recs).toHaveLength(3);
    expect(recs[0].APP_RR73_ID).toMatch(/^00000000-/);
  });

  it('makes nothing for an empty or unknown file', () => {
    expect(buildPartFile('pota|VK-0921|20261020', QSOS, ACT, OPTS)).toBeNull();
    expect(buildPartFile('bad', QSOS, ACT, OPTS)).toBeNull();
  });

  it('writes dates as on screen', () => {
    expect(dayText('20261013')).toBe('13 Oct 2026');
  });
});

describe('ADIF export', () => {
  it('exports a selection, oldest first, without deleted QSOs', () => {
    const f = buildExport(QSOS, 'VK3/9V1NE', OPTS);
    expect(f.name).toBe('RR73 VK3-9V1NE 20261015.adi');
    const adif = parseAdif(f.text);
    expect(adif.headerText).toBe('4 QSOs exported by RR73 0.5.0');
    expect(adif.records.map((r) => r.CALL)).toEqual(['VK2ESN', 'W1AW', 'ZL1TQK', 'JH1RRT']);
    expect(buildExport([], '', OPTS).name).toBe('RR73 log 20261015.adi');
  });
});

describe('sharing a file', () => {
  const FILE: ExportFile = { name: 'VK3-9V1NE@VK-0921-20261013.adi', text: '<CALL:3>K1A <EOR>' };

  function fakeDoc() {
    const clicked: { href: string; download: string }[] = [];
    const doc = {
      createElement: () => {
        const a = { href: '', download: '', rel: '', click: () => clicked.push({ href: a.href, download: a.download }), remove: vi.fn() };
        return a;
      },
      body: { append: vi.fn() },
    } as unknown as Document;
    return { doc, clicked };
  }

  it('uses the share sheet when the browser can share the file', async () => {
    const share = vi.fn(async () => undefined);
    const { doc, clicked } = fakeDoc();
    expect(await shareFile(FILE, { canShare: () => true, share } as unknown as Navigator, doc)).toEqual({ kind: 'shared' });
    const data = (share.mock.calls[0] as unknown as [ShareData])[0];
    expect(data.files?.[0].name).toBe(FILE.name);
    expect(data.files?.[0].type).toBe('text/plain');
    expect(await data.files![0].text()).toBe(FILE.text);
    expect(clicked).toEqual([]);
  });

  it('reports a cancelled share sheet', async () => {
    const share = vi.fn(async () => {
      throw new DOMException('cancelled', 'AbortError');
    });
    expect(await shareFile(FILE, { canShare: () => true, share } as unknown as Navigator, fakeDoc().doc)).toEqual({ kind: 'cancelled' });
  });

  it('downloads when files cannot be shared or sharing is refused', async () => {
    const refused = vi.fn(async () => {
      throw new DOMException('no', 'NotAllowedError');
    });
    for (const nav of [{}, { canShare: () => false, share: vi.fn() }, { canShare: () => true, share: refused }]) {
      const { doc, clicked } = fakeDoc();
      expect(await shareFile(FILE, nav as unknown as Navigator, doc)).toEqual({ kind: 'downloaded' });
      expect(clicked).toHaveLength(1);
      expect(clicked[0].download).toBe(FILE.name);
      expect(clicked[0].href).toMatch(/^blob:/);
    }
  });
});
