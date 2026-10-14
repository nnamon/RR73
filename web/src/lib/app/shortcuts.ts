/**
 * Keyboard shortcuts (the Keyboard shortcuts sheet lists them). Esc halts Tx on every screen,
 * also while typing, and the same press closes an open sheet or menu. The rest act only while no
 * text field has focus and no sheet is open. Tx on and CQ need ⌥ (Alt) so a stray key cannot start
 * a transmission. Return and the arrows act on Operate's decodes.
 */

export type Shortcut = 'halt' | 'call' | 'next' | 'previous' | 'tx' | 'cq' | 'hunt' | 'band' | 'operate' | 'log' | 'settings' | 'help';

/** The parts of a KeyboardEvent the shortcuts read. */
export interface KeyPress {
  key: string;
  code: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

/**
 * Where the focus is: a text field takes every key but Esc; a control (a button, a link, a menu
 * item) keeps Return and the arrows for itself; anything else, a decode row included, leaves them
 * to the shortcuts.
 */
export type FocusKind = 'text' | 'control' | 'none';

const ALT: Record<string, Shortcut> = { KeyT: 'tx', KeyC: 'cq', KeyH: 'hunt', Digit1: 'operate', Digit2: 'log', Digit3: 'settings' };

/** The shortcut a key press asks for, or null. ⌥ is read from the physical key: on a Mac ⌥T types †. */
export function shortcutOf(e: KeyPress, focus: FocusKind): Shortcut | null {
  if (e.key === 'Escape') return 'halt';
  if (focus === 'text' || e.ctrlKey || e.metaKey) return null;
  if (e.altKey) return ALT[e.code] ?? null;
  if (e.key === '?') return 'help';
  if (e.key === 'b' || e.key === 'B') return 'band';
  if (focus === 'control') return null;
  if (e.key === 'Enter') return 'call';
  if (e.key === 'ArrowDown') return 'next';
  if (e.key === 'ArrowUp') return 'previous';
  return null;
}

const TEXT_INPUTS = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number', 'date', 'time', 'datetime-local', '']);

/** What kind of element has the focus, for shortcutOf. Decode rows count as none. */
export function focusKind(el: Element | null): FocusKind {
  if (!el || el === document.body) return 'none';
  if (el instanceof HTMLElement && el.isContentEditable) return 'text';
  const tag = el.tagName.toLowerCase();
  if (tag === 'textarea' || tag === 'select') return 'text';
  if (tag === 'input') return TEXT_INPUTS.has((el.getAttribute('type') ?? '').toLowerCase()) ? 'text' : 'control';
  if (el.closest('[data-keys=list]')) return 'none';
  if (tag === 'button' || tag === 'summary' || (tag === 'a' && el.hasAttribute('href'))) return 'control';
  const role = el.getAttribute('role') ?? '';
  if (/^(menuitem|menuitemcheckbox|menuitemradio|radio|tab|option|slider|switch|checkbox|button|link)$/.test(role)) return 'control';
  return 'none';
}

/** Operate's decode list, while it shows: Return calls the selected station, the arrows move the selection. */
export interface ListKeys {
  call(): void;
  /** Moves the selection by `step` rows, 1 down or −1 up; with none, Down selects the first row. */
  move(step: 1 | -1): void;
}

let listKeys: ListKeys | null = null;

/** Sets the list the keys act on, or null; returns a function that clears it when it is still this one. */
export function setListKeys(keys: ListKeys): () => void {
  listKeys = keys;
  return () => {
    if (listKeys === keys) listKeys = null;
  };
}

export function currentListKeys(): ListKeys | null {
  return listKeys;
}

/**
 * The next row id from `ids` (newest first) after `current` by `step`: the first row when nothing
 * is selected and Down is pressed, the last when Up is; the ends stay where they are.
 */
export function stepSelection(ids: readonly string[], current: string | null, step: 1 | -1): string | null {
  if (!ids.length) return null;
  const i = current === null ? -1 : ids.indexOf(current);
  if (i < 0) return step === 1 ? ids[0] : ids[ids.length - 1];
  return ids[Math.min(ids.length - 1, Math.max(0, i + step))];
}
