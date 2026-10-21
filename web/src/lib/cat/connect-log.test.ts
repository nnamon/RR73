// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONNECT_LOG_KEY, WIRE_BYTES, beginAttempt, connectLogText, lastAttempt, lastAttemptStopped, logFailure, logStep, logWire, resetConnectLog, restoreAttempt, stoppedText } from './connect-log';

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

  it('says where an attempt stopped, in one line', () => {
    const at = (step: Parameters<typeof logStep>[0]) => {
      beginAttempt('ic705', 'connect', { step: 'chooser' }, 0);
      if (step.step !== 'chooser') logStep(step, 1);
      return stoppedText(lastAttempt(), 'ic705');
    };
    expect(at({ step: 'chooser' })).toBe('The last connection stopped in the browser’s port chooser.');
    expect(at({ step: 'open', options: { baudRate: 9600 } })).toBe('The last connection stopped at opening the port at 9600 baud.');
    expect(at({ step: 'signals' })).toBe('The last connection stopped at setting the port’s DTR and RTS lines low.');
    expect(at({ step: 'reply' })).toBe('The last connection stopped while waiting for the IC-705’s first reply.');
    logFailure('signals');
    expect(stoppedText(lastAttempt(), 'ic705')).toBe('The last connection failed while waiting for the IC-705’s first reply: the lines could not be set low, and USB SEND did not read OFF.');
    expect(stoppedText(lastAttempt(), 'kx2')).toBeNull();
    beginAttempt('ic705', 'auto', { step: 'port', usbVendorId: null, usbProductId: null }, 2);
    logStep({ step: 'connected' }, 3);
    expect(stoppedText(lastAttempt(), 'ic705')).toBeNull();
    expect(stoppedText(null, 'ic705')).toBeNull();
  });

  it('gives the log as text, one step a line in UTC', () => {
    const t0 = Date.UTC(2026, 9, 17, 13, 14, 30, 120);
    beginAttempt('ic705', 'connect', { step: 'chooser' }, t0);
    logStep({ step: 'port', usbVendorId: 0x0c26, usbProductId: 0x0036 }, t0 + 900);
    logStep({ step: 'forget', ports: 1 }, t0 + 910);
    logStep({ step: 'open', options: { baudRate: 115200, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' } }, t0 + 920);
    expect(connectLogText(lastAttempt(), '0.24.3', 'Chrome 141 on Windows 10')).toBe(
      [
        'RR73 0.24.3 connection log',
        'Browser: Chrome 141 on Windows 10',
        'Radio: IC-705, Connect radio, 2026-10-17',
        '13:14:30.120 UTC  Port chooser shown',
        '13:14:31.020 UTC  Port chosen, USB 0C26:0036',
        '13:14:31.030 UTC  Forgetting 1 other allowed port',
        '13:14:31.040 UTC  Opening at 115200 baud, 8 data bits, parity none, 1 stop bit, flow control none',
        'No further step recorded',
        'Sent: nothing',
        'Received: nothing',
      ].join('\n'),
    );
    expect(connectLogText(null, '0.24.3', 'x')).toContain('No connection attempt stored.');
  });
});

describe('the bytes on the wire', () => {
  it('keeps the first bytes sent and received, in hex, up to WIRE_BYTES each, and shows them in the log', () => {
    beginAttempt('ic705', 'connect', { step: 'chooser' });
    logWire('sent', Uint8Array.from([0xfe, 0xfe, 0xa4, 0xe0, 0x03, 0xfd]));
    expect(lastAttempt()?.sent).toBe('FE FE A4 E0 03 FD');
    expect(connectLogText(lastAttempt(), '0', 'test')).toContain('Received: nothing');
    logWire('received', new Uint8Array(200).fill(0xab));
    expect(lastAttempt()?.received?.split(' ')).toHaveLength(WIRE_BYTES);
    logWire('received', Uint8Array.from([1]));
    expect(lastAttempt()?.received?.split(' ')).toHaveLength(WIRE_BYTES);
    expect(connectLogText(lastAttempt(), '0', 'test')).toContain('Sent: FE FE A4 E0 03 FD');
  });
});
