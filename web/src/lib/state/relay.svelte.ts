/**
 * The relays (QSP, docs/design/qsp.md) and web SDR receive through them. Stored in IndexedDB under
 * their own key ("relay"), outside the settings record, like the practice band's switches. The app
 * ships with no relay. The operator adds each one with its access key and chooses one or none.
 *
 * While the practice band is on, it keeps the input and the web SDR waits.
 */

import { untrack } from 'svelte';
import { getKv, mergeKv, peekKv } from './db';
import { practice } from './practice.svelte';
import { settings } from './settings.svelte';
import { setInputSource, startAudio } from './station.svelte';
import { showNotice } from './qso.svelte';
import { STATUS } from '../qso/status';
import { isKeyboard } from '../clock/slots';
import { dialHz } from '../radio/bands';
import { operatingDialHz } from '../radio/hound-dial';
import { rttyDialHz } from '../rtty/dial';
import { WebSdrInput, type WebSdrStatus } from '../relay/sdr-input';
import { normaliseBase, type QspReceiver } from '../relay/qsp';
import { notify } from '../log/log.svelte';

/** A relay the operator added. */
export interface SavedRelay {
  /** QSP's API base, such as https://relay.example.org/qsp. */
  base: string;
  /** Its access key; '' for none. */
  key: string;
}

export interface RelaySettings {
  /** The relay in use: one of `relays`, or '' for none. */
  base: string;
  /** The relays added, oldest first. */
  relays: SavedRelay[];
  /** Receive from a web SDR in place of the radio. Tx stays on the radio. */
  sdrOn: boolean;
  /** The receiver's id at the relay. */
  receiver: string | null;
  /** Its name, for Operate and Settings while the relay is not asked. */
  receiverName: string;
}

export const RELAY_DEFAULTS: Readonly<RelaySettings> = { base: '', relays: [], sdrOn: false, receiver: null, receiverName: '' };

/** A relay as Settings shows it: None, or the address's host. */
export function relayName(base: string): string {
  if (!base) return 'None';
  try {
    return new URL(base).host;
  } catch {
    return base;
  }
}

const KEY = 'relay';

export const relay = $state<RelaySettings>({ ...RELAY_DEFAULTS });

/** The web SDR's session as it stands; null while it is not in use. */
export const webSdr = $state<{ status: WebSdrStatus | null }>({ status: null });

export function validateRelay(raw: unknown): RelaySettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown, d: string) => (typeof v === 'string' ? v : d);
  const relays: SavedRelay[] = [];
  for (const x of Array.isArray(r.relays) ? (r.relays as unknown[]) : []) {
    const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
    const base = typeof o.base === 'string' ? normaliseBase(o.base) : null;
    if (base && !relays.some((s) => s.base === base)) relays.push({ base, key: str(o.key, '') });
  }
  const base = typeof r.base === 'string' && relays.some((s) => s.base === r.base) ? r.base : '';
  return {
    base,
    relays,
    sdrOn: typeof r.sdrOn === 'boolean' ? r.sdrOn : RELAY_DEFAULTS.sdrOn,
    receiver: base && typeof r.receiver === 'string' && r.receiver ? r.receiver : null,
    receiverName: base ? str(r.receiverName, RELAY_DEFAULTS.receiverName) : '',
  };
}

/** The access key of a relay added, by default the one in use; '' for none. */
export function relayKey(base: string = relay.base): string {
  return relay.relays.find((s) => s.base === base)?.key ?? '';
}

let changed = false;

/** Reads the stored settings; changes made before they arrive win. */
export async function loadRelay(): Promise<void> {
  try {
    const peeked = await peekKv<unknown>(KEY);
    const stored = peeked ? peeked.value : await getKv<unknown>(KEY);
    if (!changed) Object.assign(relay, validateRelay(stored));
  } catch {
    // No storage: no relay.
  }
}

export async function updateRelay(patch: Partial<RelaySettings>): Promise<void> {
  changed = true;
  Object.assign(relay, patch);
  try {
    await mergeKv(KEY, { ...patch });
  } catch {
    // As in loadRelay.
  }
}

/** The radio's dial for the band and mode now, Hz: the receiver tunes there. */
export function currentDialHz(): number {
  const band = settings.band;
  const mode = settings.mode;
  if (isKeyboard(mode)) return rttyDialHz(band, settings.rtty.dialHz) ?? 0;
  return operatingDialHz(band, mode, settings.houndBands.includes(band), settings.houndDialHz) ?? dialHz(band, mode) ?? 0;
}

const NOTICES: Record<string, string> = {
  busy: STATUS.webSdrBusy,
  refused: STATUS.webSdrRefused,
  closed: STATUS.webSdrClosed,
  error: STATUS.webSdrClosed,
  relay: STATUS.relayUnreachable,
  'relay-refused': STATUS.relayRefused,
};

const input = new WebSdrInput({
  base: () => relay.base,
  key: () => relayKey(),
  receiver: () => relay.receiver,
  receiverName: () => relay.receiverName,
  dialHz: currentDialHz,
  listener: () => settings.callsign,
  status: (s) => {
    webSdr.status = s;
    if (s.state === 'ended' && s.reason !== 'stopped') showNotice(NOTICES[s.reason ?? 'closed'] ?? STATUS.webSdrClosed);
  },
});

/** The web SDR input while it is on and set up; null otherwise. */
export function webSdrInput(): WebSdrInput | null {
  return relay.sdrOn && relay.base && relay.receiver ? input : null;
}

/** Puts the web SDR in as the input, or the radio back, unless the practice band has it. */
function apply() {
  if (practice.on) return;
  const src = webSdrInput();
  if (!src) webSdr.status = null;
  setInputSource(src);
}

/** Turns web SDR receive on or off. Call from the tap: turning it on starts audio at once. */
export function setWebSdrOn(on: boolean) {
  void updateRelay({ sdrOn: on });
  apply();
  if (on && webSdrInput() && !practice.on) void startAudio();
}

/** Chooses the receiver; a session under way moves to it. Call from the tap. */
export function chooseReceiver(r: QspReceiver) {
  const moving = relay.sdrOn && webSdrInput() !== null && !practice.on;
  void updateRelay({ receiver: r.id, receiverName: r.name });
  if (!moving) {
    apply();
    return;
  }
  setInputSource(null);
  apply();
  void startAudio();
}

/** Chooses a relay added, or none with ''. Another relay stops the web SDR and forgets the receiver. */
export function chooseRelay(base: string) {
  if (base === relay.base || (base && !relay.relays.some((s) => s.base === base))) return;
  void updateRelay({ base, receiver: null, receiverName: '' });
  setInputSource(null);
  apply();
}

/** Adds a relay by its address, or finds it among those added, and chooses it. Returns its address, or null when the address is not one. */
export function addRelay(address: string): string | null {
  const base = normaliseBase(address);
  if (!base) return null;
  if (!relay.relays.some((s) => s.base === base)) void updateRelay({ relays: [...relay.relays, { base, key: '' }] });
  chooseRelay(base);
  return base;
}

/** Sets the access key of a relay added. */
export function setRelayKey(base: string, key: string) {
  if (!relay.relays.some((s) => s.base === base) || relayKey(base) === key) return;
  void updateRelay({ relays: relay.relays.map((s) => (s.base === base ? { base, key } : s)) });
}

/** Removes a relay added, with Undo. Removing the relay in use stops the web SDR. */
export function removeRelay(base: string) {
  if (!relay.relays.some((s) => s.base === base)) return;
  const before: RelaySettings = { ...relay, relays: relay.relays.map((s) => ({ ...s })) };
  const relays = relay.relays.filter((s) => s.base !== base);
  if (base === relay.base) {
    void updateRelay({ relays, base: '', receiver: null, receiverName: '' });
    setInputSource(null);
    apply();
  } else {
    void updateRelay({ relays });
  }
  notify({
    kind: 'cleared',
    qsoId: null,
    text: `Removed ${relayName(base)}`,
    undo: () => {
      void updateRelay(before);
      apply();
    },
  });
}

let started = false;

/** At app start: puts the web SDR in when it was on. Audio waits for a tap. */
export function initRelay() {
  if (started) return;
  started = true;
  apply();
  $effect.root(() => {
    // A change of band, mode or dial retunes the receiver.
    $effect(() => {
      const hz = currentDialHz();
      untrack(() => {
        if (webSdrInput()) input.tune(hz);
      });
    });
  });
}
