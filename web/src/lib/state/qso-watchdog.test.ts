// @vitest-environment jsdom
// The watchdog counts from the operator's last action: taps and clicks, and keystrokes too, such
// as the keyboard shortcuts on a desktop and typing in the send field.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { qso, startQso } from './qso.svelte';

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(Date.UTC(2026, 9, 16, 9, 0, 0));
  startQso();
});

afterAll(() => vi.useRealTimers());

describe('the watchdog', () => {
  it('restarts on a keystroke, as on a tap', () => {
    vi.setSystemTime(Date.UTC(2026, 9, 16, 9, 5, 0));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 't', altKey: true }));
    expect(qso.st.watchdogFromMs).toBe(Date.UTC(2026, 9, 16, 9, 5, 0));
    vi.setSystemTime(Date.UTC(2026, 9, 16, 9, 7, 0));
    window.dispatchEvent(new Event('pointerdown'));
    expect(qso.st.watchdogFromMs).toBe(Date.UTC(2026, 9, 16, 9, 7, 0));
  });
});
