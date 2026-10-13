// The log store end to end in Node: real IndexedDB code on fake-indexeddb, a fake Wavelog behind
// fetch, the outbox driven by Send now.
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../state/db';
import { settings } from '../state/settings.svelte';
import { UNDO_MS } from './ledger';
import {
  addQso,
  chooseStation,
  dismissNotice,
  endActivation,
  loadLog,
  log,
  logQso,
  markFileSubmitted,
  markQsoHandled,
  restoreQso,
  sendNow,
  setFetch,
  setFileDestination,
  setLoggingSettings,
  setWavelog,
  startActivation,
  testWavelog,
  undoQso,
  updateActivation,
  updateQso,
} from './log.svelte';
import { loadSnapshot } from './store';
import type { LogQsoRecord } from './types';
import type { FetchLike } from './wavelog';

const T = Date.now();
const RECORD: LogQsoRecord = { call: 'VK2ESN', grid: 'QF56', mode: 'FT8', band: '20m', dialHz: 14_074_000, audioHz: 1500, startUtcMs: T - 60_000, endUtcMs: T, reportSent: -12, reportRcvd: -10 };

/** A fake Wavelog whose /api/qso answer the test sets. */
const wavelog = {
  posts: [] as { station: string; key: string; adif: string }[],
  qso: (): Response => new Response(JSON.stringify({ status: 'created', adif_count: 1, adif_errors: 0 }), { status: 201 }),
};
const fake: FetchLike = async (url, init) => {
  const path = new URL(url).pathname;
  if (path.startsWith('/api/auth/')) return new Response('<auth><status>Valid</status><rights>rw</rights></auth>');
  if (path.startsWith('/api/station_info/'))
    return new Response(
      JSON.stringify([
        { station_id: '1', station_profile_name: 'Home', station_callsign: '9V1NE', station_gridsquare: 'OJ11', station_active: '1' },
        { station_id: '7', station_profile_name: 'VK3 portable', station_callsign: 'VK3/9V1NE', station_gridsquare: 'QF22', station_active: null },
      ]),
    );
  if (path === '/api/qso/true') return new Response(JSON.stringify({ status: 'created', adif_count: 0 }), { status: 201 });
  if (path === '/api/version') return new Response(JSON.stringify({ status: 'ok', version: '2.1' }));
  if (path === '/api/qso') {
    const body = JSON.parse(init.body as string) as { station_profile_id: string; key: string; string: string };
    wavelog.posts.push({ station: body.station_profile_id, key: body.key, adif: body.string });
    return wavelog.qso();
  }
  return new Response('', { status: 404 });
};

const entry = (qsoId: string, dest = 'wavelog') => log.ledger.find((e) => e.qsoId === qsoId && e.destinationId === dest);

beforeAll(async () => {
  settings.callsign = '9V1NE';
  setFetch(fake);
  await loadLog();
  await setLoggingSettings({ sendAutomatically: false });
});

describe('the log store', () => {
  it('starts empty with the default destinations', () => {
    expect(log.ready).toBe(true);
    expect(log.qsos).toEqual([]);
    expect(log.facts.map((f) => [f.id, f.active])).toEqual([
      ['wavelog', false],
      ['adif-file', false],
      ['pota-file', true],
      ['sota-file', true],
      ['wwff-file', true],
    ]);
  });

  it('logs the sequencer’s record, stores it with its ledger and shows the notice', async () => {
    const q = await logQso(RECORD);
    expect(q).toMatchObject({ call: 'VK2ESN', stationCallsign: '9V1NE', freqHz: 14_075_500, source: 'sequencer', activationId: null });
    expect(log.notice).toMatchObject({ kind: 'logged', qsoId: q.id, text: 'Logged VK2ESN 20m FT8 −12 / −10' });
    expect(log.live.map((x) => x.id)).toEqual([q.id]);
    const stored = await loadSnapshot();
    expect(stored.qsos).toEqual([q]);
    // Outside an activation the file destinations do not take it; Wavelog is not set up yet.
    expect(stored.ledger.map((e) => [e.destinationId, e.state]).sort()).toEqual([
      ['pota-file', 'not-needed'],
      ['sota-file', 'not-needed'],
      ['wwff-file', 'not-needed'],
    ]);
    dismissNotice();
    expect(log.notice).toBeNull();
  });

  it('queues every QSO for Wavelog once it is set up, and Test connection fills the station locations', async () => {
    await setWavelog({ url: 'https://log.example.test', apiKey: 'key-1' });
    const r = await testWavelog({ url: 'https://log.example.test', apiKey: 'key-1', stationId: null });
    expect(r.ok).toBe(true);
    expect(log.wavelog).toMatchObject({ stationId: '1', lastTest: { ok: true, rights: 'rw', version: '2.1' } });
    expect(log.wavelog.stations.map((s) => s.name)).toEqual(['Home', 'VK3 portable']);
    const first = log.qsos[0];
    expect(entry(first.id)).toMatchObject({ state: 'waiting' });
    const stored = await (await db()).get('destinations', 'wavelog');
    expect(stored).toMatchObject({ apiKey: 'key-1', url: 'https://log.example.test' });
  });

  it('holds a new QSO for Undo, then delivers it on Send now', async () => {
    const q = await addQso({ ...RECORD, call: 'JA1KXM' });
    expect(entry(q.id)?.nextAttemptAt).toBe(q.createdAt + UNDO_MS);
    await sendNow();
    expect(entry(q.id)).toMatchObject({ state: 'delivered', attempts: 1 });
    expect(wavelog.posts.map((p) => p.station)).toEqual(['1', '1']);
    expect(wavelog.posts.some((p) => p.adif.startsWith('<CALL:6>JA1KXM '))).toBe(true);
    expect((await (await db()).get('ledger', [q.id, 'wavelog']))?.state).toBe('delivered');
  });

  it('removes a QSO on Undo before anything is sent, and brings it back', async () => {
    const before = wavelog.posts.length;
    const q = await logQso({ ...RECORD, call: '9M2TRX' });
    await undoQso(q.id);
    expect(log.notice).toMatchObject({ kind: 'removed', text: 'Removed 9M2TRX from the log' });
    expect(log.live.some((x) => x.id === q.id)).toBe(false);
    expect(entry(q.id)?.state).toBe('not-needed');
    await sendNow();
    expect(wavelog.posts.length).toBe(before);
    await restoreQso(q.id);
    expect(entry(q.id)?.state).toBe('waiting');
    await sendNow();
    expect(entry(q.id)?.state).toBe('delivered');
  });

  it('marks an edit after delivery as changed, until handled', async () => {
    const q = log.live.find((x) => x.call === 'JA1KXM')!;
    const edited = await updateQso(q.id, { gridsquare: 'PM95', comment: 'Fixed grid' });
    expect(edited.updatedAt).toBeGreaterThan(q.updatedAt);
    expect(entry(q.id)?.state).toBe('changed');
    await markQsoHandled(q.id, 'wavelog');
    expect(entry(q.id)).toMatchObject({ state: 'delivered', deliveredUpdatedAt: edited.updatedAt });
    expect(await updateQso(q.id, { gridsquare: 'PM95' })).toEqual(edited);
  });

  it('refuses every waiting QSO when Wavelog refuses the key, and sends them after the key is changed', async () => {
    wavelog.qso = () => new Response(JSON.stringify({ status: 'failed', reason: 'API key does not have write permissions' }), { status: 403 });
    const a = await addQso({ ...RECORD, call: 'YB0AZK' });
    const b = await addQso({ ...RECORD, call: 'ZL1TQK' });
    await sendNow();
    for (const q of [a, b]) {
      expect(entry(q.id)).toMatchObject({ state: 'refused', lastError: 'Wavelog refused the API key: it can read but not write. Create a read-write key in Wavelog.', refusal: { fix: 'wavelog-key', scope: 'destination' } });
    }
    wavelog.qso = () => new Response(JSON.stringify({ status: 'created', adif_count: 1 }), { status: 201 });
    await setWavelog({ apiKey: 'key-2' });
    expect(entry(a.id)?.state).toBe('waiting');
    await sendNow();
    expect([entry(a.id)?.state, entry(b.id)?.state]).toEqual(['delivered', 'delivered']);
    expect(wavelog.posts.at(-1)?.key).toBe('key-2');
  });

  it('runs an activation: QSOs join it, files are ready, and the station location follows it', async () => {
    const a = await startActivation({
      refs: [
        { programme: 'POTA', ref: 'VK-0921' },
        { programme: 'SOTA', ref: 'VK3/VC-012' },
      ],
      callsign: 'VK3/9V1NE',
      operator: '9V1NE',
      grid: 'QF22lb',
      gridSource: 'typed',
      wavelogStationId: '7',
    });
    expect(log.current?.id).toBe(a.id);
    const q = await addQso({ ...RECORD, call: 'VK3ARR' });
    expect(q).toMatchObject({ activationId: a.id, stationCallsign: 'VK3/9V1NE', mySig: 'POTA', mySigInfo: 'VK-0921', mySotaRef: 'VK3/VC-012', myGridsquare: 'QF22lb' });
    const day = new Date(q.start).toISOString().slice(0, 10).replace(/-/g, '');
    expect(entry(q.id, 'pota-file')).toMatchObject({ state: 'file-ready', parts: [{ key: `pota|VK-0921|${day}`, submittedAt: null }] });
    expect(entry(q.id, 'sota-file')?.state).toBe('file-ready');
    await sendNow();
    expect(wavelog.posts.at(-1)?.station).toBe('7');

    await markFileSubmitted(`pota|VK-0921|${day}`);
    expect(entry(q.id, 'pota-file')?.state).toBe('submitted');

    // Adding a WWFF reference restamps the QSO: Wavelog already holds it, so it shows as changed.
    await updateActivation(a.id, { refs: [...a.refs, { programme: 'WWFF', ref: 'VKFF-0921' }] });
    expect(log.qsos.find((x) => x.id === q.id)?.myWwffRef).toBe('VKFF-0921');
    expect(entry(q.id, 'wwff-file')?.state).toBe('file-ready');
    expect(entry(q.id)?.state).toBe('changed');

    await endActivation(a.id);
    expect(log.current).toBeNull();
    const later = await addQso({ ...RECORD, call: 'W1AW' });
    expect(later.activationId).toBeNull();
  });

  it('sends station refusals again after a station location is chosen', async () => {
    const m = 'Differing station callsign <b>9V1NE</b> while importing QSO with K1ABC for <b>VK3/9V1NE</b>: SKIPPED<br>';
    wavelog.qso = () => new Response(JSON.stringify({ status: 'abort', messages: ['', m] }), { status: 400 });
    await setWavelog({ stationId: '7' });
    const q = await addQso({ ...RECORD, call: 'K1ABC' });
    await sendNow();
    expect(entry(q.id)).toMatchObject({ state: 'refused', refusal: { fix: 'wavelog-station', scope: 'qso' } });
    wavelog.qso = () => new Response(JSON.stringify({ status: 'created', adif_count: 1 }), { status: 201 });
    await chooseStation('1', null);
    expect(entry(q.id)?.state).toBe('waiting');
    await sendNow();
    expect(entry(q.id)?.state).toBe('delivered');
    expect(wavelog.posts.at(-1)?.station).toBe('1');
  });

  it('adds the ADIF file to activation QSOs when switched on', async () => {
    const q = log.live.find((x) => x.call === 'VK3ARR')!;
    expect(entry(q.id, 'adif-file')).toBeUndefined();
    await setFileDestination('adif-file', true);
    expect(entry(q.id, 'adif-file')).toMatchObject({ state: 'file-ready', parts: [{ key: `adif|${q.activationId}`, submittedAt: null }] });
  });

  it('keeps everything in IndexedDB', async () => {
    const s = await loadSnapshot();
    expect(s.qsos.length).toBe(log.qsos.length);
    expect(s.ledger.length).toBe(log.ledger.length);
    expect(s.activations).toHaveLength(1);
    expect(s.settings).toEqual({ sendAutomatically: false, sendEdits: true });
    expect(s.destinations.map((d) => d.id).sort()).toEqual(['adif-file', 'wavelog']);
  });
});
