// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONNECT_LOG_KEY, beginAttempt, lastAttempt, lastAttemptStopped, logFailure, logStep, resetConnectLog, restoreAttempt } from './connect-log';

beforeEach(() => {
  localStorage.clear();
  resetConnectLog();
});

afterEach(() => vi.restoreAllMocks());

describe('the connection log', () => {
  it('writes each step as it comes and keeps the last attempt only', () => {
    beginAttempt('ic705', 'connect', { step: 'port', usbVendorId: 0x0c26, usbProductId: 0x0036 }, 1);
    logStep({ step: 'open', options: { baudRate: 115200 } }, 2);
    expect(lastAttempt()).toEqual({
      radio: 'ic705',
      via: 'connect',
      steps: [
        { step: 'port', usbVendorId: 0x0c26, usbProductId: 0x0036, atMs: 1 },
        { step: 'open', options: { baudRate: 115200 }, atMs: 2 },
      ],
    });
    expect(lastAttemptStopped('ic705')).toBe(true);
    expect(lastAttemptStopped('kx2')).toBe(false);
    logStep({ step: 'connected' }, 3);
    logStep({ step: 'connected' }, 4);
    expect(lastAttempt()?.steps.map((s) => s.step)).toEqual(['port', 'open', 'connected']);
    expect(lastAttemptStopped('ic705')).toBe(false);
    beginAttempt('ic705', 'auto', { step: 'port', usbVendorId: null, usbProductId: null }, 5);
    expect(lastAttempt()?.steps).toHaveLength(1);
    expect(lastAttemptStopped('ic705')).toBe(true);
  });

  it('records a failure, and puts back the attempt a closed chooser replaced', () => {
    beginAttempt('ic705', 'connect', { step: 'port', usbVendorId: null, usbProductId: null }, 1);
    logStep({ step: 'connected' }, 2);
    const before = beginAttempt('ic705', 'connect', { step: 'chooser' }, 3);
    restoreAttempt(before);
    expect(lastAttemptStopped('ic705')).toBe(false);
    beginAttempt('kx2', 'reconnect', { step: 'port', usbVendorId: null, usbProductId: null }, 4);
    logFailure('busy');
    expect(lastAttempt()).toMatchObject({ radio: 'kx2', via: 'reconnect', failed: 'busy' });
  });

  it('reads nothing from a malformed entry', () => {
    localStorage.setItem(CONNECT_LOG_KEY, '{');
    expect(lastAttempt()).toBeNull();
    localStorage.setItem(CONNECT_LOG_KEY, JSON.stringify({ radio: 'ft991', steps: [] }));
    expect(lastAttempt()).toBeNull();
    localStorage.setItem(CONNECT_LOG_KEY, JSON.stringify({ radio: 'ic705', steps: [{ step: 'open' }] }));
    expect(lastAttempt()).toBeNull();
  });

  it('goes on without a log when storage refuses', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded.', 'QuotaExceededError');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Denied.', 'SecurityError');
    });
    expect(() => beginAttempt('ic705', 'connect', { step: 'chooser' })).not.toThrow();
    expect(() => logStep({ step: 'signals' })).not.toThrow();
    expect(() => logFailure('busy')).not.toThrow();
    expect(lastAttempt()).toBeNull();
    expect(lastAttemptStopped('ic705')).toBe(false);
  });
});
