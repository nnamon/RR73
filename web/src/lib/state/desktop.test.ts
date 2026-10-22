import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DesktopBridge } from '../app/desktop';
import { setUtcCorrection, utcCorrectionMs } from '../clock/utc';
import { CLOSE_HALT_MS, NTP_INTERVAL_MS, NTP_RETRY_MS, initDesktop, measureClock, ntp, restartClock } from './desktop.svelte';
import { settings } from './settings.svelte';

function fakeBridge(answers: unknown[]) {
  const calls: string[] = [];
  const servers: (string | undefined)[] = [];
  const listeners = new Map<string, () => void>();
  const bridge: DesktopBridge = {
    invoke: async <T,>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
      calls.push(cmd);
      if (cmd === 'clock_offset') servers.push(args?.server as string | undefined);
      if (cmd !== 'clock_offset') return undefined as T;
      const a = answers.shift();
      if (a instanceof Error) throw a;
      return a as T;
    },
    channel: (fn) => ({ onmessage: fn }),
    listen: async (name, handler) => {
      listeners.set(name, handler);
      return () => listeners.delete(name);
    },
  };
  return { bridge, calls, listeners, servers };
}

afterEach(() => {
  settings.ntpOn = true;
  settings.ntpServer = '';
  setUtcCorrection(0);
  ntp.sample = null;
  ntp.atMs = null;
  ntp.failed = false;
});

describe('measureClock', () => {
  it('sets the correction from a usable measurement', async () => {
    const { bridge } = fakeBridge([{ offsetMs: -1800, delayMs: 30, stratum: 2 }]);
    expect(await measureClock(bridge)).toBe(true);
    expect(utcCorrectionMs()).toBe(-1800);
    expect(ntp.sample?.offsetMs).toBe(-1800);
    expect(ntp.failed).toBe(false);
  });

  it('keeps the system time when the server does not answer', async () => {
    const { bridge } = fakeBridge([new Error('no reply')]);
    expect(await measureClock(bridge)).toBe(false);
    expect(utcCorrectionMs()).toBe(0);
    expect(ntp.failed).toBe(true);
  });

  it('refuses a measurement with a long round trip and keeps the last correction', async () => {
    const { bridge } = fakeBridge([
      { offsetMs: 900, delayMs: 20, stratum: 1 },
      { offsetMs: 5000, delayMs: 900, stratum: 1 },
    ]);
    await measureClock(bridge);
    expect(await measureClock(bridge)).toBe(false);
    expect(utcCorrectionMs()).toBe(900);
  });
});

describe('initDesktop', () => {
  it('measures again after the interval, or sooner after a failure', async () => {
    const { bridge } = fakeBridge([new Error('no reply'), { offsetMs: 10, delayMs: 10, stratum: 1 }]);
    const later: [() => void, number][] = [];
    await initDesktop({ bridge: async () => bridge, halt: () => {}, later: (fn, ms) => later.push([fn, ms]) });
    await vi.waitFor(() => expect(later.length).toBe(1));
    expect(later[0][1]).toBe(NTP_RETRY_MS);
    later[0][0]();
    await vi.waitFor(() => expect(later.length).toBe(2));
    expect(later[1][1]).toBe(NTP_INTERVAL_MS);
    expect(utcCorrectionMs()).toBe(10);
  });

  it('asks the chosen server, or the public pool when none is set', async () => {
    const { bridge, servers } = fakeBridge([{ offsetMs: 10, delayMs: 10, stratum: 1 }, { offsetMs: 20, delayMs: 10, stratum: 1 }]);
    await initDesktop({ bridge: async () => bridge, halt: () => {}, later: () => {} });
    await vi.waitFor(() => expect(servers).toHaveLength(1));
    expect(servers[0]).toBeUndefined();
    settings.ntpServer = 'time.example.org';
    restartClock();
    await vi.waitFor(() => expect(servers).toHaveLength(2));
    expect(servers[1]).toBe('time.example.org');
    expect(utcCorrectionMs()).toBe(20);
  });

  it('with the time server off, measures nothing and drops the correction', async () => {
    const { bridge, servers } = fakeBridge([{ offsetMs: 700, delayMs: 10, stratum: 1 }]);
    const later: [() => void, number][] = [];
    await initDesktop({ bridge: async () => bridge, halt: () => {}, later: (fn, ms) => later.push([fn, ms]) });
    await vi.waitFor(() => expect(utcCorrectionMs()).toBe(700));
    settings.ntpOn = false;
    restartClock();
    await vi.waitFor(() => expect(utcCorrectionMs()).toBe(0));
    expect(ntp.sample).toBeNull();
    // The cycle scheduled before the switch went off does nothing.
    later.forEach(([fn]) => fn());
    await new Promise((r) => setTimeout(r, 10));
    expect(servers).toHaveLength(1);
  });

  it('halts on close, then quits', async () => {
    const { bridge, calls, listeners } = fakeBridge([new Error('no reply')]);
    const halt = vi.fn();
    const later: [() => void, number][] = [];
    await initDesktop({ bridge: async () => bridge, halt, later: (fn, ms) => later.push([fn, ms]) });
    listeners.get('rr73://close')?.();
    expect(halt).toHaveBeenCalledOnce();
    const quit = later.find(([, ms]) => ms === CLOSE_HALT_MS);
    expect(quit).toBeDefined();
    quit?.[0]();
    await vi.waitFor(() => expect(calls).toContain('app_quit'));
  });
});
