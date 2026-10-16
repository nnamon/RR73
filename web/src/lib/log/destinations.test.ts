import { describe, expect, it } from 'vitest';
import { fileAdapter, wavelogAdapter } from './destinations';
import { createQso } from './qso';
import type { Activation, WavelogConfig } from './types';
import type { FetchLike } from './wavelog';

const T = Date.UTC(2026, 9, 13, 13, 0, 0);
const ACT: Activation = { id: 'a', refs: [{ programme: 'POTA', ref: 'VK-0921' }], callsign: 'VK3/9V1NE', operator: '9V1NE', grid: 'QF22', gridSource: 'typed', wavelogStationId: '7', startedAt: T, endedAt: null, updatedAt: T };
const q = createQso({ call: 'VK2ESN', mode: 'FT8', band: '20m', dialHz: 14_074_000, audioHz: 1500, startUtcMs: T, endUtcMs: T, reportSent: -1, reportRcvd: -2 }, { id: 'q1', now: T, activation: ACT, callsign: '9V1NE' });
const CFG: WavelogConfig = { id: 'wavelog', kind: 'wavelog', enabled: true, url: 'https://log.example.test', apiKey: 'k', stationId: '1', stations: [], lastTest: null, readWorked: false };

const fake: FetchLike = async (url) => {
  const path = new URL(url).pathname;
  if (path === '/api/auth/k') return new Response('<auth><status>Valid</status><rights>rw</rights></auth>');
  if (path === '/api/station_info/k') return new Response(JSON.stringify([{ station_id: '1', station_profile_name: 'Home', station_callsign: '9V1NE', station_active: '1' }]));
  if (path.startsWith('/api/qso')) return new Response(JSON.stringify({ status: 'created', adif_count: 1 }), { status: 201 });
  return new Response('', { status: 404 });
};

describe('destination adapters', () => {
  it('makes Wavelog a direct destination that tests and sends', async () => {
    const w = wavelogAdapter(CFG, () => '1', fake, () => T);
    expect([w.id, w.kind, w.transport]).toEqual(['wavelog', 'wavelog', 'direct']);
    expect(await w.test()).toEqual({ ok: true, message: 'Can read and write' });
    expect((await w.send!([q]))[0]).toMatchObject({ qsoId: 'q1', outcome: 'delivered' });
    expect(w.makeFile).toBeUndefined();
  });

  it('makes files for file destinations', async () => {
    const pota = fileAdapter('pota-file', '0.5.0', () => T);
    expect([pota.kind, pota.transport, pota.send]).toEqual(['pota-file', 'file', undefined]);
    expect(await pota.test()).toEqual({ ok: true, message: 'Made on this phone' });
    const f = await pota.makeFile!([q], { key: 'pota|VK-0921|20261013', activation: ACT });
    expect(f.name).toBe('VK3-9V1NE@VK-0921-20261013.adi');
    expect(await f.text()).toContain('<MY_SIG_INFO:7>VK-0921');
    await expect(pota.makeFile!([q], { key: 'pota|VK-0921|20261014', activation: ACT })).rejects.toThrow('No QSOs');
  });
});
