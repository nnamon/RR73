// The log store end to end in Node: real IndexedDB code on fake-indexeddb, a fake Wavelog behind
// fetch. Send automatically starts off, so QSOs go to Wavelog when the test sends them.
import { beforeAll, describe, expect, it } from 'vitest';
import { db, getKv } from '../state/db';
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
  outbox,
  restoreQso,
  sendToWavelog,
  setFetch,
  setFileDestination,
  setLoggingSettings,
  setWavelog,
  startActivation,
  testWavelog,
  undoQso,
  unsentForWavelog,
  updateActivation,
  updateQso,
} from './log.svelte';
import { SEND_AUTOMATICALLY_OFF } from './migrations';
import { activationPatch } from './qso';
import { loadSnapshot } from './store';
import type { LogQsoRecord } from './types';
import type { FetchLike } from './wavelog';

const T = Date.now();
const RECORD: LogQsoRecord = { call: 'VK2ESN', grid: 'QF56', mode: 'FT8', band: '20m', dialHz: 14_074_000, audioHz: 1500, startUtcMs: T - 60_000, endUtcMs: T, reportSent: -12, reportRcvd: -10 };
const created = () => new Response(JSON.stringify({ status: 'created', adif_count: 1 }), { status: 201 });

/** A fake Wavelog whose /api/qso answer the test sets, from the call in the ADIF. */
const wavelog = {
  posts: [] as { station: string; key: string; adif: string; call: string }[],
  qso: (call: string): Response | Promise<Response> => (void call, created()),
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
    const call = /<CALL:\d+>(\S+)/.exec(body.string)?.[1] ?? '';
    wavelog.posts.push({ station: body.station_profile_id, key: body.key, adif: body.string, call });
    return wavelog.qso(call);
  }
  return new Response('', { status: 404 });
};

const entry = (qsoId: string, dest = 'wavelog') => log.ledger.find((e) => e.qsoId === qsoId && e.destinationId === dest);

beforeAll(async () => {
  settings.callsign = '9V1NE';
  setFetch(fake);
  await loadLog();
});

describe('the log store', () => {
  it('starts empty, with Send automatically off and the migration recorded', async () => {
    expect(log.ready).toBe(true);
    expect(log.qsos).toEqual([]);
    expect(log.settings).toEqual({ sendAutomatically: false, sendEdits: true });
    expect(outbox.running).toBe(false);
    expect(await getKv('migrations')).toEqual([SEND_AUTOMATICALLY_OFF]);
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

  it('marks every QSO not sent once Wavelog is set up, and sends nothing by itself', async () => {
    await setWavelog({ url: 'https://log.example.test', apiKey: 'key-1' });
    // No station location yet: Wavelog takes nothing.
    expect(entry(log.qsos[0].id)).toBeUndefined();
    expect(log.facts.find((f) => f.id === 'wavelog')?.active).toBe(false);
    const r = await testWavelog({ url: 'https://log.example.test', apiKey: 'key-1', stationId: null });
    expect(r.ok).toBe(true);
    expect(log.wavelog).toMatchObject({ stationId: '1', lastTest: { ok: true, rights: 'rw', version: '2.1' } });
    expect(entry(log.qsos[0].id)).toMatchObject({ state: 'not-sent', nextAttemptAt: null });
    const q = await addQso({ ...RECORD, call: 'JA1KXM' });
    expect(entry(q.id)).toMatchObject({ state: 'not-sent', nextAttemptAt: null });
    // Even the outbox's own Send now leaves not-sent QSOs alone.
    await outbox.sendNow();
    expect(wavelog.posts).toEqual([]);
    const first = log.qsos.find((x) => x.call === 'VK2ESN')!;
    expect(unsentForWavelog().map((e) => e.qsoId).sort()).toEqual([first.id, q.id].sort());
  });

  it('keeps a QSO from the sequencer not sent, and leaves unknown reports out of the notice', async () => {
    const before = wavelog.posts.length;
    const q = await logQso({ ...RECORD, call: 'JH1RRT', source: 'sequencer' });
    expect(q.source).toBe('sequencer');
    expect(entry(q.id)).toMatchObject({ state: 'not-sent', nextAttemptAt: null });
    expect(log.notice?.text).toBe('Logged JH1RRT 20m FT8 −12 / −10');
    const hand = await logQso({ ...RECORD, call: 'VK4TMZ', source: 'manual', reportSent: '', reportRcvd: '' });
    expect(log.notice?.text).toBe('Logged VK4TMZ 20m FT8');
    await logQso({ ...RECORD, call: 'VK5PAS', source: 'manual', reportSent: '-07', reportRcvd: '' });
    expect(log.notice?.text).toBe('Logged VK5PAS 20m FT8 sent −07');
    await outbox.sendNow();
    expect(wavelog.posts.length).toBe(before);
    expect(entry(hand.id)?.state).toBe('not-sent');
    expect(await sendToWavelog([q.id, hand.id, log.qsos.find((x) => x.call === 'VK5PAS')!.id])).toMatchObject({ total: 3, delivered: 3 });
    wavelog.posts.splice(before);
  });

  it('sends every QSO not sent on Send to Wavelog, oldest first, with progress and a summary', async () => {
    const older = await addQso({ ...RECORD, call: 'ZL1TQK', startUtcMs: T - 3_600_000, endUtcMs: T - 3_590_000 });
    const progress: string[] = [];
    const seen = new Set<number>();
    wavelog.qso = (call) => {
      if (!seen.has(log.sync.done)) progress.push(`${log.sync.done + 1} of ${log.sync.total}`);
      seen.add(log.sync.done);
      void call;
      return created();
    };
    const summary = await sendToWavelog();
    expect(wavelog.posts.map((p) => p.call)).toEqual(['ZL1TQK', 'VK2ESN', 'JA1KXM']);
    expect(progress).toEqual(['1 of 3', '2 of 3', '3 of 3']);
    expect(summary).toMatchObject({ total: 3, delivered: 3, refused: 0, unsent: 0, text: '3 delivered.', ok: true });
    expect(log.sync).toMatchObject({ running: false, total: 3, done: 3 });
    expect(log.notice).toMatchObject({ kind: 'info', text: '3 delivered.' });
    expect(entry(older.id)?.state).toBe('delivered');
    expect(unsentForWavelog()).toEqual([]);
    expect(await sendToWavelog()).toBeNull();
  });

  it('reports mixed results: delivered, a duplicate, and a QSO Wavelog refuses', async () => {
    const calls = ['W1AW', 'K1ABC', 'DL1XYZ', 'G4ABC'];
    for (const [i, call] of calls.entries()) await addQso({ ...RECORD, call, startUtcMs: T - 100_000 + i * 1000, endUtcMs: T - 99_000 + i * 1000 });
    const band = "QSO on 2026-10-13: Band '20m' is not in the band configuration. This QSO wasn't imported.<br>";
    wavelog.qso = (call) =>
      call === 'K1ABC'
        ? new Response(JSON.stringify({ status: 'abort', messages: ['', 'Date/Time: 2026-10-13 13:00:00 Callsign: K1ABC Band: 20m Duplicate for 9V1NE<br>'] }), { status: 400 })
        : call === 'DL1XYZ'
          ? new Response(JSON.stringify({ status: 'abort', messages: ['', band] }), { status: 400 })
          : created();
    const before = wavelog.posts.length;
    const summary = await sendToWavelog();
    expect(wavelog.posts.slice(before).map((p) => p.call)).toEqual(calls);
    expect(summary).toMatchObject({ total: 4, delivered: 3, refused: 1, unsent: 0, text: '3 delivered. 1 refused: see To do.', ok: false });
    const dl = log.qsos.find((q) => q.call === 'DL1XYZ')!;
    expect(entry(dl.id)).toMatchObject({ state: 'refused', refusal: { fix: 'resend', scope: 'qso' } });
    expect(entry(log.qsos.find((q) => q.call === 'K1ABC')!.id)).toMatchObject({ state: 'delivered', duplicate: true });

    // Send again from the refused row: one QSO, sent at once.
    wavelog.qso = () => created();
    expect(await sendToWavelog([dl.id])).toMatchObject({ total: 1, delivered: 1, text: 'Delivered DL1XYZ to Wavelog.' });
  });

  it('stops at a failure and leaves the rest not sent, saying why', async () => {
    const a = await addQso({ ...RECORD, call: 'VK3ARR', startUtcMs: T - 50_000, endUtcMs: T - 49_000 });
    const b = await addQso({ ...RECORD, call: 'VK4TMZ', startUtcMs: T - 40_000, endUtcMs: T - 39_000 });
    wavelog.qso = () => Promise.reject(new TypeError('Load failed'));
    const summary = await sendToWavelog();
    expect(summary).toMatchObject({ total: 2, delivered: 0, refused: 0, unsent: 2, ok: false });
    expect(summary?.text).toBe('Could not reach Wavelog at log.example.test. Check the address and that this phone is online. 2 QSOs are not sent.');
    expect(entry(a.id)).toMatchObject({ state: 'not-sent', attempts: 1, nextAttemptAt: null });
    expect(entry(a.id)?.lastError).toBe('Could not reach Wavelog at log.example.test. Check the address and that this phone is online.');
    expect(entry(b.id)).toMatchObject({ state: 'not-sent', attempts: 0 });
    wavelog.qso = () => created();
    expect(await sendToWavelog()).toMatchObject({ delivered: 2, text: '2 delivered.' });
  });

  it('removes a QSO on Undo, and a restored one is not sent again until sent', async () => {
    const q = await logQso({ ...RECORD, call: '9M2TRX' });
    await undoQso(q.id);
    expect(log.notice).toMatchObject({ kind: 'removed', text: 'Removed 9M2TRX from the log' });
    expect(entry(q.id)?.state).toBe('not-needed');
    expect(unsentForWavelog().some((e) => e.qsoId === q.id)).toBe(false);
    await restoreQso(q.id);
    expect(entry(q.id)?.state).toBe('not-sent');
    expect(await sendToWavelog()).toMatchObject({ delivered: 1 });
  });

  it('marks an edit after delivery as changed, until handled', async () => {
    const q = log.live.find((x) => x.call === 'JA1KXM')!;
    const edited = await updateQso(q.id, { gridsquare: 'PM95', comment: 'Fixed grid' });
    expect(edited.updatedAt).toBeGreaterThan(q.updatedAt);
    expect(entry(q.id)?.state).toBe('changed');
    expect(unsentForWavelog().some((e) => e.qsoId === q.id)).toBe(false);
    await markQsoHandled(q.id, 'wavelog');
    expect(entry(q.id)).toMatchObject({ state: 'delivered', deliveredUpdatedAt: edited.updatedAt });
    expect(await updateQso(q.id, { gridsquare: 'PM95' })).toEqual(edited);
  });

  it('with Send automatically on, holds a new QSO for Undo and sends it by itself; off again, queued QSOs wait', async () => {
    const waitingBefore = await addQso({ ...RECORD, call: 'JH1RRT' });
    expect(entry(waitingBefore.id)?.state).toBe('not-sent');
    await setLoggingSettings({ sendAutomatically: true });
    expect(outbox.running).toBe(true);
    expect(entry(waitingBefore.id)?.state).toBe('waiting');
    const q = await addQso({ ...RECORD, call: 'VK5PAS' });
    expect(entry(q.id)).toMatchObject({ state: 'waiting', nextAttemptAt: q.createdAt + UNDO_MS });
    await setLoggingSettings({ sendAutomatically: false });
    expect(outbox.running).toBe(false);
    expect(entry(q.id)).toMatchObject({ state: 'not-sent', nextAttemptAt: null });
    expect(entry(waitingBefore.id)?.state).toBe('not-sent');
    expect(await sendToWavelog()).toMatchObject({ delivered: 2 });
  });

  it('refuses every QSO not sent when Wavelog refuses the key, and they are ready again after the key changes', async () => {
    wavelog.qso = () => new Response(JSON.stringify({ status: 'failed', reason: 'API key does not have write permissions' }), { status: 403 });
    const a = await addQso({ ...RECORD, call: 'YB0AZK' });
    const b = await addQso({ ...RECORD, call: 'ZL2AB' });
    const summary = await sendToWavelog();
    expect(summary).toMatchObject({ total: 2, refused: 2, text: '2 refused: see To do.' });
    for (const q of [a, b]) {
      expect(entry(q.id)).toMatchObject({ state: 'refused', lastError: 'Wavelog refused the API key: it can read but not write. Create a read-write key in Wavelog.', refusal: { fix: 'wavelog-key', scope: 'destination' } });
    }
    wavelog.qso = () => created();
    await setWavelog({ apiKey: 'key-2' });
    expect([entry(a.id)?.state, entry(b.id)?.state]).toEqual(['not-sent', 'not-sent']);
    expect(await sendToWavelog()).toMatchObject({ delivered: 2 });
    expect(wavelog.posts.at(-1)?.key).toBe('key-2');
  });

  it('runs an activation: QSOs join it, files are ready, and the station location follows it', async () => {
    settings.features.activations = true;
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
    await sendToWavelog();
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
    await sendToWavelog();
  });

  it('makes station refusals ready again after a station location is chosen', async () => {
    const m = 'Differing station callsign <b>9V1NE</b> while importing QSO with K1ABC for <b>VK3/9V1NE</b>: SKIPPED<br>';
    wavelog.qso = () => new Response(JSON.stringify({ status: 'abort', messages: ['', m] }), { status: 400 });
    await setWavelog({ stationId: '7' });
    const q = await addQso({ ...RECORD, call: 'K1ABC' });
    await sendToWavelog();
    expect(entry(q.id)).toMatchObject({ state: 'refused', refusal: { fix: 'wavelog-station', scope: 'qso' } });
    wavelog.qso = () => created();
    await chooseStation('1', null);
    expect(entry(q.id)?.state).toBe('not-sent');
    await sendToWavelog();
    expect(entry(q.id)?.state).toBe('delivered');
    expect(wavelog.posts.at(-1)?.station).toBe('1');
  });

  it('adds the ADIF file to activation QSOs when switched on', async () => {
    const q = log.live.find((x) => x.call === 'VK3ARR' && x.activationId !== null)!;
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
    expect(s.migrations).toEqual([SEND_AUTOMATICALLY_OFF]);
    expect(s.destinations.map((d) => d.id).sort()).toEqual(['adif-file', 'wavelog']);
    expect((await (await db()).get('kv', 'logging'))?.value).toEqual({ sendAutomatically: false, sendEdits: true });
  });

  it('keeps new QSOs out of a running activation while Activations is off', async () => {
    const a = await startActivation({ refs: [{ programme: 'POTA', ref: 'VK-0921' }], callsign: 'VK3/9V1NE', operator: '9V1NE', grid: 'QF22', gridSource: 'typed', wavelogStationId: null });
    settings.features.activations = false;
    const q = await addQso({ ...RECORD, call: 'JA1KXM' });
    expect(q).toMatchObject({ activationId: null, stationCallsign: '9V1NE', mySig: '' });
    // Turning it back on shows the same activation, still running, and QSOs join it again.
    settings.features.activations = true;
    expect(log.current?.id).toBe(a.id);
    expect((await addQso({ ...RECORD, call: 'ZL1TQK' })).activationId).toBe(a.id);
  });

  it('moves a logged QSO into the running activation and out again, keeping what went on air', async () => {
    const a = log.current!;
    const q = log.live.find((x) => x.call === 'JA1KXM')!;
    expect(q.activationId).toBeNull();
    const day = new Date(q.start).toISOString().slice(0, 10).replace(/-/g, '');
    const joined = await updateQso(q.id, activationPatch(a));
    expect(joined).toMatchObject({ activationId: a.id, mySig: 'POTA', mySigInfo: 'VK-0921', myPotaRef: 'VK-0921', stationCallsign: '9V1NE', myGridsquare: q.myGridsquare });
    expect(entry(q.id, 'pota-file')).toMatchObject({ state: 'file-ready', parts: [{ key: `pota|VK-0921|${day}`, submittedAt: null }] });
    const left = await updateQso(q.id, activationPatch(null));
    expect(left).toMatchObject({ activationId: null, mySig: '', mySigInfo: '', myPotaRef: '' });
    expect(entry(q.id, 'pota-file')?.parts ?? []).toEqual([]);
  });
});
