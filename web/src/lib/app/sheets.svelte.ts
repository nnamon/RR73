/**
 * Sheets that open from more than one place: the band sheet from the top bar and the B key, and
 * the keyboard shortcuts from the ? key.
 */
export const sheets = $state({ band: false, shortcuts: false });

/** True while a sheet or another modal dialog is open: the shortcuts other than Esc wait. */
export function sheetOpen(): boolean {
  return typeof document !== 'undefined' && !!document.querySelector('dialog[open]');
}
