// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import AudioBanner from './AudioBanner.svelte';

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
});
