// @vitest-environment jsdom
// Hiding the page: output halts where hiding stops capture (iOS), and carries on in desktop
// Chromium, which keeps receiving in a hidden page.
import { afterEach, describe, expect, it } from 'vitest';
import { onHalt } from './station.svelte';

const IPHONE = navigator.userAgent;
// lint-copy: off
const CHROME_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36';
// lint-copy: on

function platform(userAgent: string, userAgentData?: { mobile: boolean; platform: string }) {
  Object.defineProperty(navigator, 'userAgent', { value: userAgent, configurable: true });
  Object.defineProperty(navigator, 'userAgentData', { value: userAgentData, configurable: true });
}

function hide() {
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
}

afterEach(() => platform(IPHONE));

describe('a hidden page', () => {
  it('halts output on iOS, where hiding stops the microphone', () => {
    let halts = 0;
    const off = onHalt(() => halts++);
    platform(IPHONE);
    hide();
    off();
    expect(halts).toBe(1);
  });

  it('keeps output going in Chrome or Edge on Windows, which keep capture running', () => {
    let halts = 0;
    const off = onHalt(() => halts++);
    platform(CHROME_WIN, { mobile: false, platform: 'Windows' });
    hide();
    off();
    expect(halts).toBe(0);
  });

  it('halts output when the page goes away, everywhere', () => {
    let halts = 0;
    const off = onHalt(() => halts++);
    platform(CHROME_WIN, { mobile: false, platform: 'Windows' });
    window.dispatchEvent(new Event('pagehide'));
    off();
    expect(halts).toBe(1);
  });
});
