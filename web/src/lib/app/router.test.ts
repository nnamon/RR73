import { describe, expect, it } from 'vitest';
import { TABS, tabOf } from './router.svelte';

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
