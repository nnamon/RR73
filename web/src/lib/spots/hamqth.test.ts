import { describe, expect, it, vi } from 'vitest';
import { HAMQTH_JSON_URL, HAMQTH_SPOTS_URL, hamqthSource, hamqthSpot, normaliseHamqthJson, parseHamqthCsv } from './hamqth';
import { SPOT_CLASSES, SpotFetchError, spotClasses, type Spot } from './types';
import { HAMQTH_0554, HAMQTH_V2_0554, recorded, recordedText } from '../testing/spots';

const at = (h: number, m: number) => Date.UTC(2026, 9, 13, h, m, 0);
const csv = parseHamqthCsv(recordedText(HAMQTH_0554));

function line(n: number): Spot {
  return csv.spots[n - 1];
}

describe('HamQTH cluster lines recorded at 05:54 UTC', () => {
  it('reads all 20 lines', () => {
    expect(csv).toMatchObject({ skipped: 0, lines: 20, wellFormed: 20 });
    expect(csv.spots).toHaveLength(20);
  });

  it('reads a POTA and IOTA spot in full', () => {
    expect(line(8)).toEqual({
      id: `hamqth:ZL1KS@${at(5, 47)}/F5NZO/14237.0`,
      source: 'hamqth',
      activator: 'ZL1KS',
      refs: [
        { programme: 'POTA', ref: 'NZ-0008', name: '' },
        { programme: 'IOTA', ref: 'OC-134', name: '' },
      ],
      country: 'New Zealand',
      freqHz: 14_237_000,
      band: '20m',
      mode: '',
      digital: null,
      spottedAt: at(5, 47),
      spotter: 'F5NZO',
      automatic: false,
      snrDb: null,
      qrt: false,
      comments: 'POTA NZ-0008 IOTA OC-134',
    });
  });

  it('reads a POTA comment in lower case on a portable call', () => {
    expect(line(1)).toMatchObject({ activator: 'PD4US/P', refs: [{ programme: 'POTA', ref: 'NL-0110' }], band: '20m', spotter: 'PD4US' });
  });

  it('keeps plain DX spots as DX', () => {
    expect(line(7)).toMatchObject({ activator: 'VK2GJC', refs: [], country: 'Australia', comments: 'cq dx', digital: null });
    expect(spotClasses(line(7))).toEqual(['DX']);
    expect(spotClasses(line(8))).toEqual(['POTA', 'IOTA']);
  });

  it('finds FT8 in comments, and by frequency when the comment is empty', () => {
    expect(line(3)).toMatchObject({ activator: 'ZL3TX', freqHz: 7_074_000, comments: '', digital: 'FT8' });
    expect(line(4)).toMatchObject({ activator: 'IZ8DUD', freqHz: 5_356_500, band: '60m', digital: 'FT8' });
    expect(line(10)).toMatchObject({ activator: 'ZL2CC', freqHz: 5_355_500, digital: 'FT8' });
    expect(line(11)).toMatchObject({ activator: 'JA8NRS', freqHz: 21_076_900, digital: 'FT8' });
    expect(line(14)).toMatchObject({ activator: '3D2USU', freqHz: 24_915_000, digital: 'FT8', refs: [{ programme: 'IOTA', ref: 'OC-016' }] });
    expect(line(19)).toMatchObject({ activator: '9H1ES', freqHz: 1_840_000, band: '160m', digital: 'FT8' });
  });

  it('keeps WSPR in the 30m FT8 window out', () => {
    expect(line(12)).toMatchObject({ activator: 'LX0QRP', freqHz: 10_138_700, comments: 'wspr sign -35', digital: null });
  });

  it('reads VHF, UHF and microwave frequencies', () => {
    expect(line(9)).toMatchObject({ activator: 'R7NK', freqHz: 144_174_000, band: '2m', digital: 'FT8', comments: '<TR> FT8 -6 dB 813 Hz' });
    expect(line(17)).toMatchObject({ freqHz: 432_222_000, band: '70cm', digital: null });
    expect(line(18)).toMatchObject({ activator: 'Z81Q', freqHz: 10_489_770_000, band: '3cm', country: 'Republic of South Sudan' });
    expect(line(20)).toMatchObject({ freqHz: 1_296_222_000, band: '23cm' });
  });

  it('keeps countries with an ampersand and SSB and CW spots without a mode', () => {
    expect(csv.spots.find((s) => s.activator === 'J88IH')).toMatchObject({ country: 'Saint Vincent & Grenadines', digital: 'FT8' });
    expect(line(5)).toMatchObject({ activator: 'IQ3TR', freqHz: 7_161_000, digital: null, mode: '' });
    expect(line(6)).toMatchObject({ activator: 'H49A', freqHz: 14_030_000, digital: null, comments: 'UP1' });
  });

  it('lists 8 FT8 spots and 3 with programme references', () => {
    expect(csv.spots.filter((s) => s.digital === 'FT8').map((s) => s.activator)).toEqual(['ZL3TX', 'IZ8DUD', 'R7NK', 'ZL2CC', 'JA8NRS', '3D2USU', 'J88IH', '9H1ES']);
    expect(csv.spots.filter((s) => s.refs.length).map((s) => s.activator)).toEqual(['PD4US/P', 'ZL1KS', '3D2USU']);
  });
});

describe('HamQTH edge cases', () => {
  const ok = 'F5NZO^14237.0^ZL1KS^POTA NZ-0008^0547 2026-10-13^L^^OC^20M^New Zealand^170';

  it('keeps a ^ inside a comment', () => {
    expect(hamqthSpot('F5NZO^14237.0^ZL1KS^tnx ^ 73^0547 2026-10-13^L^^OC^20M^New Zealand^170')).toMatchObject({ comments: 'tnx ^ 73', country: 'New Zealand', spottedAt: at(5, 47) });
  });

  it('skips lines without enough fields, a callsign or a time', () => {
    const r = parseHamqthCsv(
      [
        ok,
        'F5NZO^14237.0^ZL1KS^POTA NZ-0008^0547 2026-10-13^L^^OC^20M^New Zealand',
        'F5NZO^14237.0^^POTA NZ-0008^0547 2026-10-13^L^^OC^20M^New Zealand^170',
        'F5NZO^14237.0^ZL1KS^POTA NZ-0008^2547 2026-10-13^L^^OC^20M^New Zealand^170',
        'F5NZO^14237.0^ZL1KS^POTA NZ-0008^05:47 13.10.2026^L^^OC^20M^New Zealand^170',
        '<html><body>Service unavailable</body></html>',
        '',
        '   ',
      ].join('\r\n'),
    );
    expect(r.spots).toHaveLength(1);
    expect(r.skipped).toBe(5);
  });

  it('keeps a spot with an unreadable frequency, without a band', () => {
    expect(hamqthSpot('F5NZO^^ZL1KS^cq^0547 2026-10-13^^^OC^^New Zealand^170')).toMatchObject({ freqHz: null, band: null, digital: null });
    expect(hamqthSpot('F5NZO^14.074^ZL1KS^^0547 2026-10-13^^^OC^20M^New Zealand^170')).toMatchObject({ freqHz: 14_074_000, digital: 'FT8' });
  });

  it('reads skimmer spots from the cluster with their SNR', () => {
    expect(hamqthSpot('W3LPL-#^14025.0^OL7M^CW 24 dB 28 WPM CQ^0547 2026-10-13^^^EU^20M^Czech Republic^503')).toMatchObject({ spotter: 'W3LPL', automatic: true, snrDb: 24 });
  });

  it('marks QRT', () => {
    expect(hamqthSpot('F5NZO^14237.0^ZL1KS^QRT tnx^0547 2026-10-13^^^OC^20M^New Zealand^170')?.qrt).toBe(true);
  });
});

describe('the JSON API answer recorded at 05:54 UTC', () => {
  const r = normaliseHamqthJson(recorded(HAMQTH_V2_0554))!;
  const of = (call: string, minute: number) => r.spots.find((s) => s.activator === call && new Date(s.spottedAt).getUTCMinutes() === minute)!;

  it('reads all 15 spots', () => {
    expect(r.skipped).toBe(0);
    expect(r.spots).toHaveLength(15);
  });

  it('gives a spot the same fields, and the same id, as its CSV line', () => {
    const fromCsv = recorded8();
    const fromJson = of('ZL1KS', 47);
    expect(fromJson).toEqual({ ...fromCsv, mode: 'SSB' });
  });

  it('uses the mode: SSB and CW rule FT8 out, DIGI and none leave it to comments and frequency', () => {
    expect(of('PD4US/P', 53)).toMatchObject({ mode: 'SSB', digital: null, refs: [{ programme: 'POTA', ref: 'NL-0110' }] });
    expect(of('ZL3TX', 53)).toMatchObject({ mode: 'DIGI', digital: 'FT8' });
    expect(of('IQ3TR', 36)).toMatchObject({ mode: 'DIGI', digital: 'FT8', freqHz: 14_074_000 });
    expect(of('LX0QRP', 36)).toMatchObject({ mode: 'DIGI', digital: null });
    expect(of('3D2USU', 27)).toMatchObject({ mode: 'DIGI', digital: 'FT8', refs: [{ programme: 'IOTA', ref: 'OC-016' }] });
    expect(of('EA2PW', 24)).toMatchObject({ mode: '', digital: null });
    expect(of('Z81Q', 49)).toMatchObject({ mode: '', band: '3cm' });
  });

  it('refuses an answer without a spot list, and skips entries it cannot read', () => {
    expect(normaliseHamqthJson(null)).toBeNull();
    expect(normaliseHamqthJson([])).toBeNull();
    expect(normaliseHamqthJson({ spots: 'none' })).toBeNull();
    expect(normaliseHamqthJson({ spots: [null, 5, { dxcall: 'ZL1KS' }, { dxcall: 'ZL1KS', time: '2026-10-13T05:47:00Z', freq: 14237 }] })).toMatchObject({ skipped: 3, spots: [{ activator: 'ZL1KS', freqHz: 14_237_000 }] });
  });
});

/** Line 8 of the CSV recording: ZL1KS, POTA NZ-0008 IOTA OC-134. */
function recorded8(): Spot {
  return line(8);
}

/** A fetch that answers each URL from a table, counting requests. */
function serve(table: Record<string, () => Response | Promise<Response>>) {
  const asked: string[] = [];
  const fetch = vi.fn(async (url: string) => {
    asked.push(url === HAMQTH_SPOTS_URL ? 'csv' : url === HAMQTH_JSON_URL ? 'json' : url);
    const answer = table[url];
    if (!answer) throw new TypeError('Load failed');
    return answer();
  });
  return { fetch, asked };
}

const signal = () => new AbortController().signal;
const csvOk = () => new Response(recordedText(HAMQTH_0554));
const jsonOk = () => new Response(recordedText(HAMQTH_V2_0554));

describe('hamqthSource', () => {
  it('reads the CSV feed without credentials or the HTTP cache, and credits HamQTH', async () => {
    const { fetch } = serve({ [HAMQTH_SPOTS_URL]: csvOk });
    const source = hamqthSource({ fetch });
    expect(source).toMatchObject({ id: 'hamqth', name: 'HamQTH', classes: SPOT_CLASSES, credit: 'DX cluster data provided by HamQTH.com.', format: 'csv' });
    expect(await source.fetch(signal())).toHaveLength(20);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://www.hamqth.com/dxc_csv.php?limit=200');
    expect(HAMQTH_JSON_URL).toBe('https://www.hamqth.com/api/v2/spots?limit=200');
    expect(init).toMatchObject({ credentials: 'omit', cache: 'no-store' });
  });

  it('switches to the JSON API at once on an HTTP error, for good, and says so once', async () => {
    const log = vi.fn();
    const { fetch, asked } = serve({ [HAMQTH_SPOTS_URL]: () => new Response('', { status: 404 }), [HAMQTH_JSON_URL]: jsonOk });
    const source = hamqthSource({ fetch, log });
    expect(await source.fetch(signal())).toHaveLength(15);
    expect(source.format).toBe('json');
    expect(await source.fetch(signal())).toHaveLength(15);
    expect(asked).toEqual(['csv', 'json', 'json']);
    expect(log).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith('RR73 spots: the HamQTH CSV feed answered with HTTP 404. Using the HamQTH JSON API until the app restarts.');
  });

  it('switches when most lines lose their frequency or time', async () => {
    const log = vi.fn();
    // The fields reordered: call, frequency, time and spotter as the developer page's header lists them.
    const reordered = recordedText(HAMQTH_0554)
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        const f = l.split('^');
        return [f[2], f[1], f[4], f[0], f[3], ...f.slice(5)].join('^');
      })
      .join('\n');
    const { fetch, asked } = serve({ [HAMQTH_SPOTS_URL]: () => new Response(reordered), [HAMQTH_JSON_URL]: jsonOk });
    const source = hamqthSource({ fetch, log });
    expect(await source.fetch(signal())).toHaveLength(15);
    expect(asked).toEqual(['csv', 'json']);
    expect(log).toHaveBeenCalledWith('RR73 spots: the HamQTH CSV feed changed layout: 0 of 20 lines readable. Using the HamQTH JSON API until the app restarts.');
  });

  it('switches on an error page served as 200', async () => {
    const { fetch, asked } = serve({ [HAMQTH_SPOTS_URL]: () => new Response('<html><body>Moved to API v2</body></html>'), [HAMQTH_JSON_URL]: jsonOk });
    const source = hamqthSource({ fetch, log: () => {} });
    expect(await source.fetch(signal())).toHaveLength(15);
    expect(asked).toEqual(['csv', 'json']);
  });

  it('stays on CSV while at least half the lines read', async () => {
    const good = recordedText(HAMQTH_0554).split('\n').filter(Boolean).slice(0, 4);
    const body = [...good, 'x^y^z', 'a^b', '???', 'F5NZO^fast^ZL1KS^cq^soon^^^OC^20M^New Zealand^170'].join('\n');
    const log = vi.fn();
    const { fetch, asked } = serve({ [HAMQTH_SPOTS_URL]: () => new Response(body), [HAMQTH_JSON_URL]: jsonOk });
    const source = hamqthSource({ fetch, log });
    expect(await source.fetch(signal())).toHaveLength(4);
    expect(asked).toEqual(['csv']);
    expect(source.format).toBe('csv');
    expect(log).not.toHaveBeenCalled();
  });

  it('stays on CSV after a network failure, a timeout, a 429 or an empty answer', async () => {
    const log = vi.fn();
    for (const answer of [
      () => Promise.reject(new TypeError('Load failed')),
      () => new Response('', { status: 429 }),
    ]) {
      const { fetch, asked } = serve({ [HAMQTH_SPOTS_URL]: answer, [HAMQTH_JSON_URL]: jsonOk });
      const source = hamqthSource({ fetch, log });
      await expect(source.fetch(signal())).rejects.toBeInstanceOf(SpotFetchError);
      expect(asked).toEqual(['csv']);
      expect(source.format).toBe('csv');
    }
    const timeout = hamqthSource({ fetch: (_u, init) => new Promise((_r, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))), timeoutMs: 5, log });
    await expect(timeout.fetch(signal())).rejects.toMatchObject({ kind: 'timeout' });
    expect(timeout.format).toBe('csv');
    const empty = hamqthSource({ fetch: async () => new Response(''), log });
    expect(await empty.fetch(signal())).toEqual([]);
    expect(empty.format).toBe('csv');
    expect(log).not.toHaveBeenCalled();
  });

  it('keeps JSON after a switch even when JSON fails, and passes its errors on', async () => {
    const log = vi.fn();
    let jsonUp = false;
    const { fetch, asked } = serve({
      [HAMQTH_SPOTS_URL]: () => new Response('', { status: 500 }),
      [HAMQTH_JSON_URL]: () => (jsonUp ? jsonOk() : new Response('', { status: 503 })),
    });
    const source = hamqthSource({ fetch, log });
    await expect(source.fetch(signal())).rejects.toMatchObject({ kind: 'http', status: 503 });
    jsonUp = true;
    expect(await source.fetch(signal())).toHaveLength(15);
    expect(asked).toEqual(['csv', 'json', 'json']);
    expect(log).toHaveBeenCalledOnce();
    const odd = hamqthSource({ fetch: serve({ [HAMQTH_SPOTS_URL]: () => new Response('', { status: 500 }), [HAMQTH_JSON_URL]: () => new Response('{"error":"x"}') }).fetch, log: () => {} });
    await expect(odd.fetch(signal())).rejects.toMatchObject({ kind: 'format' });
  });

  it('logs to the console by default', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { fetch } = serve({ [HAMQTH_SPOTS_URL]: () => new Response('', { status: 410 }), [HAMQTH_JSON_URL]: jsonOk });
    await hamqthSource({ fetch }).fetch(signal());
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
