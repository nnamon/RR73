import { describe, expect, it } from 'vitest';
import { redirectOf, TABS, tabOf } from './router.svelte';

describe('tabOf', () => {
  it('has four tabs', () => {
    expect(TABS).toEqual(['operate', 'log', 'spots', 'settings']);
  });

  it('opens Spots for the Activate tab of earlier versions', () => {
    expect(tabOf(['activate'])).toBe('spots');
  });

  it('keeps known tabs and sends unknown paths to Operate', () => {
    expect(tabOf(['settings', 'radio'])).toBe('settings');
    expect(tabOf(['nowhere'])).toBe('operate');
  });
});

describe('the Spots screen', () => {
  it('sends Spots and the Activate path of earlier versions to Settings › Optional features while hidden', () => {
    expect(redirectOf(['spots'], false)).toEqual(['settings', 'features']);
    expect(redirectOf(['activate'], false)).toEqual(['settings', 'features']);
    expect(redirectOf(['spots'], true)).toBeNull();
    expect(redirectOf(['activate'], true)).toBeNull();
    expect(redirectOf(['log', 'activations'], false)).toBeNull();
    expect(redirectOf(['settings'], false)).toBeNull();
  });
});
