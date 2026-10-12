// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { WakeLockKeeper } from './wakelock';

function fakeLock(refuse = false) {
  const sentinels: { released: boolean; release: () => Promise<void>; fire: () => void }[] = [];
  const api = {
    request: vi.fn(async () => {
      if (refuse) throw new DOMException('no', 'NotAllowedError');
      let onRelease = () => {};
      const s = {
        released: false,
        release: async () => {
          s.released = true;
        },
        addEventListener: (_: string, fn: () => void) => {
          onRelease = fn;
        },
        fire: () => {
          s.released = true;
          onRelease();
        },
      };
      sentinels.push(s);
      return s;
    }),
  };
  return { nav: { wakeLock: api } as unknown as Navigator, api, sentinels };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

function setVisibility(v: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: v, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('WakeLockKeeper', () => {
  it('holds the lock while wanted and releases it when not', async () => {
    setVisibility('visible');
    const f = fakeLock();
    const k = new WakeLockKeeper(f.nav, document);
    k.set(true);
    await tick();
    expect(k.state).toBe('held');
    k.set(false);
    await tick();
    expect(k.state).toBe('off');
    expect(f.sentinels[0].released).toBe(true);
  });

  it('asks again when the page is visible after the system dropped the lock', async () => {
    setVisibility('visible');
    const f = fakeLock();
    const k = new WakeLockKeeper(f.nav, document);
    k.set(true);
    await tick();
    setVisibility('hidden');
    f.sentinels[0].fire();
    expect(k.state).toBe('refused');
    setVisibility('visible');
    await tick();
    expect(f.api.request).toHaveBeenCalledTimes(2);
    expect(k.state).toBe('held');
  });

  it('reports a refusal and a missing API', async () => {
    setVisibility('visible');
    const k = new WakeLockKeeper(fakeLock(true).nav, document);
    k.set(true);
    await tick();
    expect(k.state).toBe('refused');
    expect(new WakeLockKeeper({} as Navigator, document).state).toBe('unsupported');
  });
});
