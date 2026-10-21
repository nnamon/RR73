import { describe, expect, it } from 'vitest';
import { isDesktop } from './desktop';

describe('isDesktop', () => {
  it('is true where Tauri injected its internals', () => {
    expect(isDesktop({ __TAURI_INTERNALS__: {} })).toBe(true);
  });

  it('is false in a browser', () => {
    expect(isDesktop({})).toBe(false);
    expect(isDesktop(globalThis)).toBe(false);
    expect(isDesktop(undefined)).toBe(false);
  });
});
