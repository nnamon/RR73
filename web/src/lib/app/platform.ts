/**
 * The system RR73 runs on, for advice that names its settings, and whether capture survives a
 * hidden page.
 *
 * - ios: an iPhone or an iPad. iPadOS Safari reports a Mac, with a touch screen. Every browser on
 *   iOS is WebKit, so the advice names Safari and iOS Settings.
 * - windows: a Windows computer or tablet, in Chrome or Edge.
 * - android: an Android phone or tablet.
 * - other: macOS, Linux and ChromeOS. The advice names no system settings there.
 */

export type Platform = 'ios' | 'android' | 'windows' | 'other';

/** The parts of navigator the detection reads. userAgentData exists in Chromium only. */
export interface NavigatorLike {
  readonly userAgent: string;
  readonly maxTouchPoints?: number;
  readonly userAgentData?: { readonly mobile?: boolean; readonly platform?: string };
}

export function platformOf(nav: NavigatorLike | undefined): Platform {
  if (!nav) return 'other';
  const ua = nav.userAgent ?? '';
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1)) return 'ios';
  if (nav.userAgentData?.platform === 'Android' || /Android/.test(ua)) return 'android';
  if (nav.userAgentData?.platform === 'Windows' || /Windows NT/.test(ua)) return 'windows';
  return 'other';
}

/**
 * True where capture keeps running while the page is hidden: Chromium on a desktop system, which
 * keeps the microphone and a running AudioContext going in a background tab and a minimised or
 * covered window. iOS stops the microphone in the background. Android and the other desktop
 * browsers are not measured, so they keep the iOS rule.
 */
export function capturesHidden(nav: NavigatorLike | undefined): boolean {
  if (!nav) return false;
  const p = platformOf(nav);
  return (p === 'windows' || p === 'other') && nav.userAgentData?.mobile === false;
}

/** What the operator calls the device in a sentence: a phone on iOS and Android, a computer elsewhere. */
export function deviceOf(p: Platform): 'phone' | 'computer' {
  return p === 'ios' || p === 'android' ? 'phone' : 'computer';
}

const nav: NavigatorLike | undefined = typeof navigator === 'undefined' ? undefined : navigator;

/** The platform of this page. */
export const platform: Platform = platformOf(nav);

/** "phone" or "computer", for "this phone" and "the phone’s clock". */
export const device = deviceOf(platform);

/** `device` with a capital, for a row title or the start of a sentence. */
export const Device = device === 'phone' ? 'Phone' : 'Computer';
