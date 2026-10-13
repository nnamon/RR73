// A phone that ran 0.5.0, where Send automatically was on and a QSO was queued for Wavelog: the
// first start of this version switches sending off once, and a later choice to turn it on sticks
// across a restart (fresh modules on the same IndexedDB).
import { describe, expect, it, vi } from 'vitest';
import { openRr73 } from '../state/db';
import { SEND_AUTOMATICALLY_OFF } from './migrations';
import { createQso } from './qso';
import type { LedgerEntry, WavelogConfig } from './types';

const T = Date.now() - 3_600_000;
const qso = createQso(
  { call: 'VK2ESN', mode: 'FT8', band: '20m', dialHz: 14_074_000, audioHz: 1500, startUtcMs: T, endUtcMs: T, reportSent: -12, reportRcvd: -10 },
  { id: '00000000-0000-4000-8000-000000000001', now: T, activation: null, callsign: '9V1NE' },
);
const queued: LedgerEntry = {
  qsoId: qso.id,
  destinationId: 'wavelog',
  state: 'waiting',
  attempts: 1,
  lastAttemptAt: T + 20_000,
  nextAttemptAt: T + 50_000,
  lastError: 'Could not reach Wavelog at log.example.test. Check the address and that this phone is online. RR73 tries again later.',
  refusal: null,
  remoteRef: null,
  deliveredAt: null,
  deliveredUpdatedAt: null,
  possibleDuplicate: false,
  duplicate: false,
  parts: [],
};
const WAVELOG: WavelogConfig = { id: 'wavelog', kind: 'wavelog', enabled: true, url: 'https://log.example.test', apiKey: 'k', stationId: '1', stations: [], lastTest: null };

describe('upgrading from 0.5.0', () => {
  it('switches Send automatically off once, keeps the queued QSO as not sent, and a later choice sticks', async () => {
    const d = await openRr73();
    await d.put('kv', { key: 'logging', value: { sendAutomatically: true, sendEdits: true } });
    await d.put('kv', { key: 'settings', value: { callsign: '9V1NE' } });
    await d.put('qsos', qso);
    await d.put('ledger', queued);
    await d.put('destinations', WAVELOG);
    d.close();

    const first = await import('./log.svelte');
    // No request may leave: there is no Wavelog behind this address.
    first.setFetch(() => Promise.reject(new TypeError('no network in this test')));
    await first.loadLog();
    expect(first.log.settings.sendAutomatically).toBe(false);
    expect(first.outbox.running).toBe(false);
    expect(first.log.ledger.find((e) => e.qsoId === qso.id)).toMatchObject({ state: 'not-sent', nextAttemptAt: null, lastError: queued.lastError });
    const check = await openRr73();
    expect((await check.get('kv', 'migrations'))?.value).toEqual([SEND_AUTOMATICALLY_OFF]);
    expect((await check.get('kv', 'logging'))?.value).toEqual({ sendAutomatically: false, sendEdits: true });
    expect((await check.get('ledger', [qso.id, 'wavelog']))?.state).toBe('not-sent');
    check.close();

    // The operator turns it on again; after a restart it stays on.
    await first.setLoggingSettings({ sendAutomatically: true });
    first.outbox.stop();
    vi.resetModules();
    const second = await import('./log.svelte');
    second.setFetch(() => Promise.reject(new TypeError('no network in this test')));
    await second.loadLog();
    second.outbox.stop();
    expect(second.log.settings.sendAutomatically).toBe(true);
    expect(second.log.ledger.find((e) => e.qsoId === qso.id)?.state).toBe('waiting');
  });
});
