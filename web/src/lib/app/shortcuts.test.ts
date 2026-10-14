// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { focusKind, shortcutOf, stepSelection, type FocusKind, type KeyPress } from './shortcuts';

const press = (key: string, code = '', mods: Partial<KeyPress> = {}): KeyPress => ({ key, code, altKey: false, ctrlKey: false, metaKey: false, ...mods });
const alt = (key: string, code: string) => press(key, code, { altKey: true });

describe('shortcutOf', () => {
  it('halts on Esc wherever the focus is', () => {
    for (const focus of ['none', 'control', 'text'] as FocusKind[]) expect(shortcutOf(press('Escape', 'Escape'), focus)).toBe('halt');
    expect(shortcutOf(press('Escape', 'Escape', { metaKey: true }), 'none')).toBe('halt');
  });

  it('reads ⌥ shortcuts from the physical key, as a Mac types † for ⌥T', () => {
    expect(shortcutOf(alt('†', 'KeyT'), 'none')).toBe('tx');
    expect(shortcutOf(alt('ç', 'KeyC'), 'none')).toBe('cq');
    expect(shortcutOf(alt('˙', 'KeyH'), 'none')).toBe('hunt');
    expect(shortcutOf(alt('¡', 'Digit1'), 'none')).toBe('operate');
    expect(shortcutOf(alt('™', 'Digit2'), 'control')).toBe('log');
    expect(shortcutOf(alt('£', 'Digit3'), 'control')).toBe('settings');
    expect(shortcutOf(alt('å', 'KeyA'), 'none')).toBeNull();
  });

  it('never starts a transmission from a key without ⌥', () => {
    expect(shortcutOf(press('t', 'KeyT'), 'none')).toBeNull();
    expect(shortcutOf(press('c', 'KeyC'), 'none')).toBeNull();
    expect(shortcutOf(press('h', 'KeyH'), 'none')).toBeNull();
    expect(shortcutOf(press('1', 'Digit1'), 'none')).toBeNull();
  });

  it('opens the band sheet with B and the shortcuts with ?', () => {
    expect(shortcutOf(press('b', 'KeyB'), 'none')).toBe('band');
    expect(shortcutOf(press('B', 'KeyB'), 'control')).toBe('band');
    expect(shortcutOf(press('?', 'Slash'), 'none')).toBe('help');
  });

  it('calls with Return and moves the selection with the arrows, unless a control has the focus', () => {
    expect(shortcutOf(press('Enter', 'Enter'), 'none')).toBe('call');
    expect(shortcutOf(press('ArrowDown', 'ArrowDown'), 'none')).toBe('next');
    expect(shortcutOf(press('ArrowUp', 'ArrowUp'), 'none')).toBe('previous');
    expect(shortcutOf(press('Enter', 'Enter'), 'control')).toBeNull();
    expect(shortcutOf(press('ArrowDown', 'ArrowDown'), 'control')).toBeNull();
  });

  it('leaves every key but Esc to a text field', () => {
    for (const k of [press('b', 'KeyB'), press('?', 'Slash'), press('Enter', 'Enter'), press('ArrowUp', 'ArrowUp'), alt('†', 'KeyT')]) {
      expect(shortcutOf(k, 'text'), k.key).toBeNull();
    }
  });

  it('leaves ⌘ and Ctrl combinations to the browser', () => {
    expect(shortcutOf(press('b', 'KeyB', { metaKey: true }), 'none')).toBeNull();
    expect(shortcutOf(press('t', 'KeyT', { ctrlKey: true, altKey: true }), 'none')).toBeNull();
  });
});

describe('focusKind', () => {
  const make = (html: string) => {
    document.body.innerHTML = html;
    return document.body.firstElementChild!;
  };

  it('counts text fields, selects and editable text as text', () => {
    expect(focusKind(make('<input type="text">'))).toBe('text');
    expect(focusKind(make('<input>'))).toBe('text');
    expect(focusKind(make('<input type="search">'))).toBe('text');
    expect(focusKind(make('<textarea></textarea>'))).toBe('text');
    expect(focusKind(make('<select><option>1</option></select>'))).toBe('text');
  });

  it('counts buttons, links, switches and menu items as controls', () => {
    expect(focusKind(make('<button>CQ</button>'))).toBe('control');
    expect(focusKind(make('<a href="#/log">Log</a>'))).toBe('control');
    expect(focusKind(make('<input type="checkbox">'))).toBe('control');
    expect(focusKind(make('<div role="menuitem" tabindex="0">End QSO</div>'))).toBe('control');
  });

  it('leaves decode rows and the page to the shortcuts', () => {
    const list = make('<ul data-keys="list"><li><button class="dr">CQ VK3ZOI QF22</button></li></ul>');
    expect(focusKind(list.querySelector('button'))).toBe('none');
    expect(focusKind(document.body)).toBe('none');
    expect(focusKind(null)).toBe('none');
  });
});

describe('stepSelection', () => {
  const ids = ['a', 'b', 'c'];

  it('starts at the newest row on Down and at the oldest on Up', () => {
    expect(stepSelection(ids, null, 1)).toBe('a');
    expect(stepSelection(ids, null, -1)).toBe('c');
    expect(stepSelection(ids, 'gone', 1)).toBe('a');
  });

  it('moves one row and stops at the ends', () => {
    expect(stepSelection(ids, 'a', 1)).toBe('b');
    expect(stepSelection(ids, 'b', -1)).toBe('a');
    expect(stepSelection(ids, 'a', -1)).toBe('a');
    expect(stepSelection(ids, 'c', 1)).toBe('c');
    expect(stepSelection([], null, 1)).toBeNull();
  });
});
