import { describe, expect, it } from 'vitest';
import { stationFacts } from './station';
import { DxccIndex } from '../reference';
import type { Qso } from '../log/types';

const NOW = Date.UTC(2026, 9, 14, 14, 5, 40);
const countries = DxccIndex.fromJson({
  format: 1,
  version: '2026-09-15',
  source: 'test',
  notice: 'MIT',
  entities: [{ name: 'Japan', prefix: 'JA', wae: false, dxcc: 339, cq: 25, itu: 45, cont: 'AS', lat: 36.4, lon: 138.38, utc: 9, aliases: 'JA' }],
});

const qso = (over: Partial<Qso>): Qso => ({ call: 'JA1XYZ', band: '20m', mode: 'RTTY', submode: '', start: NOW - 3_600_000, deletedAt: null, ...over }) as Qso;

describe('the station in a keyboard QSO', () => {
  it('gives country, grid, distance and bearing from my grid', () => {
    const f = stationFacts('JA1XYZ', 'PM95', 'OJ11', countries, [], NOW);
    expect(f.where).toMatch(/^Japan · PM95 · [\d,]+ km · \d+°$/);
    expect(f.before).toBe('Not yet');
  });

  it('gives what it knows: the country alone, or nothing', () => {
    expect(stationFacts('JA1XYZ', '', 'OJ11', countries, [], NOW).where).toBe('Japan');
    expect(stationFacts('JA1XYZ', 'PM95', '', countries, [], NOW).where).toBe('Japan · PM95');
    expect(stationFacts('JA1XYZ', '', 'OJ11', null, [], NOW).where).toBe('Country not known');
  });

  it('lists the 3 latest QSOs with the station, today by time, earlier by date, deleted ones left out', () => {
    const qsos = [
      qso({ start: Date.UTC(2026, 9, 14, 9, 14) }),
      qso({ call: 'JA1XYZ/P', band: '40m', mode: 'FT8', start: Date.UTC(2026, 9, 12, 11, 0) }),
      qso({ band: '15m', deletedAt: 1 }),
      qso({ call: 'JA2ABC' }),
      qso({ band: '10m', mode: 'MFSK', submode: 'FT4', start: Date.UTC(2026, 9, 1) }),
      qso({ band: '17m', start: Date.UTC(2026, 8, 1) }),
    ];
    expect(stationFacts('JA1XYZ', '', '', countries, qsos, NOW).before).toBe('20m RTTY at 09:14, 40m FT8 on 2026-10-12, 10m FT4 on 2026-10-01');
  });
});
