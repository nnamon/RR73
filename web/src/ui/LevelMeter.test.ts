// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import LevelMeter from './LevelMeter.svelte';

let app: ReturnType<typeof mount> | null = null;

function render(props: { rmsDb: number; live: boolean }) {
  const target = document.createElement('div');
  document.body.append(target);
  app = mount(LevelMeter, { target, props });
  flushSync();
  return target.querySelector<HTMLElement>('[role=meter]')!;
}

afterEach(() => {
  if (app) unmount(app);
  app = null;
  document.body.innerHTML = '';
});

describe('LevelMeter in the Operate header', () => {
  it('shows no label with audio off, where the audio banner says so', () => {
    const meter = render({ rmsDb: -120, live: false });
    expect(meter.textContent?.trim()).toBe('');
    expect(meter.getAttribute('aria-valuetext')).toBe('No audio');
  });

  it('shows the level in dBFS while audio runs', () => {
    const meter = render({ rmsDb: -21.2, live: true });
    expect(meter.textContent?.trim()).toBe('−21 dBFS');
  });
});
