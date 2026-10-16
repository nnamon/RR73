// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import AudioBanner from './AudioBanner.svelte';
import { adviceFor } from '../lib/app/advice';

let app: ReturnType<typeof mount> | null = null;

function render(props: Record<string, unknown>) {
  const target = document.createElement('div');
  document.body.append(target);
  app = mount(AudioBanner, { target, props: { status: 'stopped', reason: 'interrupted', error: null, stoppedAtUtcMs: Date.UTC(2026, 9, 15, 8, 1, 2), onstart: () => {}, onresume: () => {}, ...props } });
  flushSync();
  return target;
}

afterEach(() => {
  if (app) unmount(app);
  app = null;
  document.body.innerHTML = '';
});

describe('AudioBanner', () => {
  it('offers Log QSO beside Resume audio when audio stopped in a QSO that can be logged', () => {
    const onlog = vi.fn();
    const el = render({ logCall: 'JA1KXM', onlog });
    const buttons = [...el.querySelectorAll('button')];
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(['Resume audio', 'Log QSO']);
    expect(buttons[1].getAttribute('aria-label')).toBe('Log the QSO with JA1KXM');
    buttons[1].click();
    expect(onlog).toHaveBeenCalledOnce();
  });

  it('offers only Resume audio without such a QSO, and nothing to log while audio is off', () => {
    expect([...render({ logCall: null, onlog: () => {} }).querySelectorAll('button')].map((b) => b.textContent?.trim())).toEqual(['Resume audio']);
    unmount(app!);
    app = null;
    expect([...render({ status: 'off', logCall: 'JA1KXM', onlog: () => {} }).querySelectorAll('button')].map((b) => b.textContent?.trim())).toEqual(['Start audio']);
  });

  it('words a refused microphone, a hidden page and the permission prompt for the platform', () => {
    const text = (props: Record<string, unknown>) => {
      const el = render(props);
      const t = el.querySelector('.s')?.textContent ?? '';
      unmount(app!);
      app = null;
      return t;
    };
    const ios = adviceFor('ios');
    const windows = adviceFor('windows');
    expect(text({ status: 'failed', error: 'denied', advice: ios })).toBe('RR73 has no microphone access. Allow the microphone for this site in Safari settings, then start audio again.');
    expect(text({ status: 'failed', error: 'denied', advice: windows })).toBe(
      'RR73 has no microphone access. Allow the microphone for this site in the browser’s site settings, and turn on Let desktop apps access your microphone in Windows Settings › Privacy & security › Microphone. Then start audio again.',
    );
    expect(text({ status: 'failed', error: 'unsupported', advice: windows })).toBe('This browser cannot capture audio. Open RR73 in Chrome or Edge.');
    expect(text({ status: 'stopped', reason: 'hidden', advice: ios })).toBe('RR73 left the screen, and iOS stops the microphone in the background. Transmit is off.');
    expect(text({ status: 'starting', advice: ios })).toBe('Allow the microphone if Safari asks.');
    expect(text({ status: 'starting', advice: windows })).toBe('Allow the microphone if the browser asks.');
  });
});
