import { describe, expect, it, vi } from 'vitest';
import { normalisePota, potaSource, potaSpot, POTA_SPOTS_URL } from './pota';
import type { Spot } from './types';
import { POTA_0532, POTA_0536, recorded, recordedText } from '../testing/spots';

const at = (h: number, m: number, s: number) => Date.UTC(2026, 9, 13, h, m, s);

function byCall(spots: Spot[], call: string): Spot {
  const s = spots.find((x) => x.activator === call);
  if (!s) throw new Error(`No spot for ${call}`);
  return s;
}

/** The first record of the 05:32 recording with fields replaced. */
function record(over: Record<string, unknown>): Record<string, unknown> {
  const base = (recorded(POTA_0532) as Record<string, unknown>[])[0];
  return { ...base, ...over };
}

describe('POTA spots recorded at 05:32 UTC', () => {
  const r = normalisePota(recorded(POTA_0532))!;

  it('keeps every record', () => {
    expect(r.skipped).toBe(0);
    expect(r.spots).toHaveLength(12);
  });

  it('reads a skimmer spot in full', () => {
    expect(byCall(r.spots, '9W2EZV')).toEqual({
      id: 'pota:58617948',
      source: 'pota',
      activator: '9W2EZV',
      refs: [{ programme: 'POTA', ref: 'MY-0179', name: 'Dataran Nilai Park Recreation Park' }],
      country: '',
      freqHz: 28_074_000,
      band: '10m',
      mode: 'FT8',
      digital: 'FT8',
      spottedAt: at(5, 21, 25),
      spotter: 'JI1HFJ',
      automatic: true,
      snrDb: 10,
      qrt: false,
      comments: 'RBN 10 dB via JI1HFJ-#',
    });
  });

  it('reads a spot made on the web, with QRT in the comments', () => {
    const s = byCall(r.spots, '7L1DST/P');
    expect(s).toMatchObject({ freqHz: 18_100_000, band: '17m', digital: 'FT8', automatic: false, snrDb: null, qrt: true, spotter: '7L1DST' });
  });

  it('reads decimal kHz, 6m and an empty mode', () => {
    expect(byCall(r.spots, 'JJ3IUS/3')).toMatchObject({ freqHz: 7_010_500, band: '40m', mode: 'CW', digital: null, snrDb: 5 });
    expect(byCall(r.spots, 'JK1XOQ/1')).toMatchObject({ freqHz: 50_190_000, band: '6m', mode: 'SSB', digital: null });
    expect(byCall(r.spots, 'JQ3ONB/3')).toMatchObject({ mode: '', digital: null, comments: 'JCC 2511', band: '40m' });
  });

  it('keeps names in any script', () => {
    expect(byCall(r.spots, 'BA7KHZ').refs[0].name).toBe('广东肇庆东湖公园 Recreation Park');
  });

  it('finds the 6 FT8 spots and no FT4', () => {
    expect(r.spots.filter((s) => s.digital === 'FT8').map((s) => s.activator).sort()).toEqual(['7L1DST/P', '9W2EZV', 'JE1QEV', 'JG1RBB/P', 'JH2KAG/P', 'KC5JEC']);
    expect(r.spots.some((s) => s.digital === 'FT4')).toBe(false);
  });

  it('gives every spot a band, a time and an activator', () => {
    for (const s of r.spots) {
      expect(s.band, s.activator).not.toBeNull();
      expect(Number.isFinite(s.spottedAt)).toBe(true);
      expect(s.activator).toMatch(/^[A-Z0-9/]+$/);
    }
  });
});

describe('POTA spots recorded at 05:36 UTC', () => {
  const r = normalisePota(recorded(POTA_0536))!;

  it('keeps every record', () => {
    expect(r.skipped).toBe(0);
    expect(r.spots).toHaveLength(8);
  });

  it('reads a GridTracker spot: no SNR from its report text', () => {
    expect(byCall(r.spots, 'JG1RBB/P')).toMatchObject({
      freqHz: 14_075_000,
      band: '20m',
      digital: 'FT8',
      spotter: 'DS1VAA',
      automatic: false,
      snrDb: null,
      comments: 'FT8 Sent: -14 Rcvd: +00',
      spottedAt: at(5, 36, 1),
    });
  });

  it('reads negative skimmer SNRs', () => {
    expect(byCall(r.spots, 'KC5JEC')).toMatchObject({ snrDb: -11, spotter: 'N6TV', band: '80m' });
    expect(byCall(r.spots, '9W2EZV').snrDb).toBe(-1);
  });

  it('reads an empty mode with only a JCC number in the comments', () => {
    expect(byCall(r.spots, 'JA4RQO/9')).toMatchObject({ mode: '', digital: null, freqHz: 10_123_000, band: '30m' });
  });
});

describe('POTA edge cases', () => {
  it('skips records without an activator or a time, marked invalid, or not objects', () => {
    const r = normalisePota([
      record({ activator: '' }),
      record({ activator: undefined }),
      record({ spotTime: null }),
      record({ spotTime: 'soon' }),
      record({ invalid: true }),
      record({ invalid: 1 }),
      null,
      5,
      'spot',
      record({}),
    ])!;
    expect(r.skipped).toBe(9);
    expect(r.spots).toHaveLength(1);
  });

  it('keeps a spot without a frequency, with no band', () => {
    expect(potaSpot(record({ frequency: '' }))).toMatchObject({ freqHz: null, band: null });
    expect(potaSpot(record({ frequency: undefined }))).toMatchObject({ freqHz: null, band: null });
  });

  it('reads MHz typed into the kHz field and numeric frequencies', () => {
    expect(potaSpot(record({ frequency: '14.074' }))?.freqHz).toBe(14_074_000);
    expect(potaSpot(record({ frequency: 7074 }))?.freqHz).toBe(7_074_000);
  });

  it('finds FT4 in the comments of a DATA spot, and FT8 by frequency without a mode', () => {
    expect(potaSpot(record({ mode: 'data', comments: 'FT4 up 1500', source: 'Web', spotter: 'W1AW' }))).toMatchObject({ mode: 'DATA', digital: 'FT4', automatic: false });
    expect(potaSpot(record({ mode: '', comments: 'jcc 2905', frequency: '7075.2' }))).toMatchObject({ mode: '', digital: 'FT8' });
    expect(potaSpot(record({ mode: 'CW', comments: '', frequency: '7074' }))).toMatchObject({ digital: null });
  });

  it('falls back to parkName, and to activator and time for the id', () => {
    const s = potaSpot(record({ name: null, parkName: 'Old name', spotId: undefined }))!;
    expect(s.refs).toEqual([{ programme: 'POTA', ref: 'MY-0179', name: 'Old name' }]);
    expect(s.id).toBe(`pota:9W2EZV@${at(5, 21, 25)}`);
    expect(potaSpot(record({ reference: '' }))?.refs).toEqual([]);
  });

  it('upper-cases the activator and the reference', () => {
    expect(potaSpot(record({ activator: 'vk3qrp/p', reference: 'vk-0921' }))).toMatchObject({ activator: 'VK3QRP/P', refs: [{ ref: 'VK-0921' }] });
  });

  it('gives no SNR for a web spot that mentions dB', () => {
    expect(potaSpot(record({ source: 'Web', spotter: 'W1AW', comments: '20 dB over S9' }))).toMatchObject({ automatic: false, snrDb: null });
  });

  it('refuses a response that is not a list', () => {
    expect(normalisePota({ spots: [] })).toBeNull();
    expect(normalisePota(null)).toBeNull();
    expect(normalisePota('[]')).toBeNull();
    expect(normalisePota([])).toEqual({ spots: [], skipped: 0 });
  });
});

describe('potaSource', () => {
  it('fetches the activator list without credentials or the HTTP cache', async () => {
    const fetch = vi.fn(async () => new Response(recordedText(POTA_0536), { status: 200 }));
    const source = potaSource({ fetch });
    expect(source).toMatchObject({ id: 'pota', name: 'POTA', classes: ['POTA'], credit: null });
    const spots = await source.fetch(new AbortController().signal);
    expect(spots).toHaveLength(8);
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.pota.app/spot/activator');
    expect(url).toBe(POTA_SPOTS_URL);
    expect(init).toMatchObject({ credentials: 'omit', cache: 'no-store' });
  });

  it('says the answer is unreadable when it is not a list', async () => {
    const fetch = async () => new Response('{"message":"Missing Authentication Token"}', { status: 200 });
    await expect(potaSource({ fetch }).fetch(new AbortController().signal)).rejects.toMatchObject({ kind: 'format' });
  });

  it('passes HTTP errors on', async () => {
    const fetch = async () => new Response('busy', { status: 503 });
    await expect(potaSource({ fetch }).fetch(new AbortController().signal)).rejects.toMatchObject({ kind: 'http', status: 503 });
  });
});
