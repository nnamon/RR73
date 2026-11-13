/**
 * Advice that names the system's own settings or browser: iOS keeps the words it has always had,
 * Windows names Chrome, Edge and Windows Settings, and other systems get words that name neither.
 * Windows paths are those of Windows 11, as Microsoft's support pages give them.
 */

import { platform, type Platform } from './platform';

/** One item of Radio and audio's Before you transmit list. */
export interface CheckItem {
  key: 'focus' | 'clicks' | 'volume' | 'sounds' | 'output' | 'power';
  title: string;
  sub?: string;
}

export interface Advice {
  /** Why audio stopped when the page was hidden. */
  hidden: string;
  /** The browser cannot capture audio. */
  unsupported: string;
  /** The microphone was refused. */
  denied: string;
  /** While the microphone permission may be asked. */
  allowPrompt: string;
  /** Radio and audio's Screen row when the screen cannot be kept on. */
  screen: string;
  /** Radio and audio's Before you transmit list. */
  checklist: CheckItem[];
  /** How to set the clock, after the warning's first sentence. */
  clockFix: string;
  /** Copy timing report refused. */
  copyRefused: string;
  /** Who refuses plain http, in Wavelog's address check. */
  httpRefuser: string;
  /** Location refused. */
  locationOff: string;
  /** What refuses to store the log. */
  storageRefuser: string;
  /** The activation panel's offline notice. */
  offline: string;
}

const IOS: Advice = {
  hidden: 'RR73 left the screen, and iOS stops the microphone in the background.',
  unsupported: 'This browser cannot capture audio. Open RR73 in Safari.',
  denied: 'RR73 has no microphone access. Allow the microphone for this site in Safari settings, then start audio again.',
  allowPrompt: 'Allow the microphone if Safari asks.',
  screen: 'Set Auto-Lock to Never',
  checklist: [
    { key: 'focus', title: 'Focus mode on', sub: 'No iOS sounds on the air' },
    { key: 'clicks', title: 'Keyboard clicks off' },
    { key: 'volume', title: 'Phone volume at maximum' },
  ],
  clockFix: 'Connect to a network and turn on Set Automatically in the phone’s Settings › General › Date & Time.',
  copyRefused: 'The phone refused to copy. Select the report below and copy it.',
  httpRefuser: 'Safari',
  locationOff: 'Location is off for RR73. Allow it in iOS Settings › Privacy, or type the grid.',
  storageRefuser: 'This phone',
  offline: 'No phone signal',
};

const OTHER: Advice = {
  hidden: 'RR73 was hidden, and in this browser it stops the microphone in the background.',
  unsupported: 'This browser cannot capture audio. Open RR73 in Chrome or Edge.',
  denied: 'RR73 has no microphone access. Allow the microphone for this site in the browser’s site settings, then start audio again.',
  allowPrompt: 'Allow the microphone if the browser asks.',
  screen: 'Set the screen and sleep times to Never',
  checklist: [
    { key: 'sounds', title: 'System sounds off' },
    { key: 'output', title: 'Radio not the default output' },
    { key: 'power', title: 'Sleep set to Never' },
  ],
  clockFix: 'Connect to a network and turn on automatic date and time in the system settings.',
  copyRefused: 'The browser refused to copy. Select the report below and copy it.',
  httpRefuser: 'The browser',
  locationOff: 'Location is off for RR73. Allow it for this site in the browser’s site settings, or type the grid.',
  storageRefuser: 'The browser',
  offline: 'No network',
};

const WINDOWS: Advice = {
  ...OTHER,
  denied:
    'RR73 has no microphone access. Allow the microphone for this site in the browser’s site settings, and turn on Let desktop apps access your microphone in Windows Settings › Privacy & security › Microphone. Then start audio again.',
  screen: 'Set the screen and sleep timeouts to Never in Settings › System › Power & battery',
  checklist: [
    { key: 'sounds', title: 'System sounds off' },
    { key: 'output', title: 'Radio not the default output', sub: 'In Settings › System › Sound › Output' },
    { key: 'power', title: 'Sleep set to Never', sub: 'In Settings › System › Power & battery' },
  ],
  clockFix: 'Connect to a network, then turn on Set time automatically in Windows Settings › Time & language › Date & time and select Sync now.',
  locationOff: 'Location is off for RR73. Allow it for this site in the browser’s site settings and in Windows Settings › Privacy & security › Location, or type the grid.',
};

const ANDROID: Advice = {
  ...OTHER,
  unsupported: 'This browser cannot capture audio. Open RR73 in Chrome.',
  screen: 'Set the screen timeout to the longest',
  clockFix: 'Connect to a network and turn on automatic date and time in the phone’s settings.',
  storageRefuser: 'This phone',
  offline: 'No phone signal',
};

export function adviceFor(p: Platform): Advice {
  return p === 'ios' ? IOS : p === 'windows' ? WINDOWS : p === 'android' ? ANDROID : OTHER;
}

/** The advice for this page's platform. */
export const advice = adviceFor(platform);
