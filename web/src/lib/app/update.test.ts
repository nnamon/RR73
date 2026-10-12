import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checkUpdated, dismissNotice, reloadIfIdle, update } from './update.svelte';

function store(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}

describe('update notice', () => {
  beforeEach(() => {
    update.notice = null;
    update.ready = false;
  });

  it('says nothing on the first run and records the version', () => {
    const s = store();
    checkUpdated('0.1.0', s);
    expect(update.notice).toBeNull();
    expect(s.m.get('rr73.lastVersion')).toBe('0.1.0');
  });

  it('announces a newer version once', () => {
    const s = store({ 'rr73.lastVersion': '0.1.0' });
    checkUpdated('0.1.1', s);
    expect(update.notice).toBe('0.1.1');
    dismissNotice();
    checkUpdated('0.1.1', s);
    expect(update.notice).toBeNull();
  });

  it('says nothing after a downgrade', () => {
    checkUpdated('0.1.0', store({ 'rr73.lastVersion': '0.2.0' }));
    expect(update.notice).toBeNull();
  });

  it('reloads into a ready update only when idle', () => {
    const reload = vi.fn();
    expect(reloadIfIdle(false, reload)).toBe(false);
    update.ready = true;
    expect(reloadIfIdle(true, reload)).toBe(false);
    expect(reloadIfIdle(false, reload)).toBe(true);
    expect(reload).toHaveBeenCalledOnce();
  });
});
