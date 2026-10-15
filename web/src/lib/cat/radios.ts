/**
 * What differs between the radios rig control knows (docs/design/cat.md), for the one link that
 * drives them all (lib/cat/radio.ts): the requests that set the data mode, the reads of the mode,
 * the settings read on connecting, the answers that take longer, and how PTT on is confirmed. The
 * protocol itself is the codec's (lib/cat/protocol.ts).
 */

import type { CatEvent, CatRequest, SettingId } from './protocol';
import type { RadioState } from './radio';

export type CatRadioId = 'ic705' | 'kx2';

/** One setting read on connecting, and again every 5 s until the radio answers or refuses it. */
export interface SettingRead {
  id: SettingId;
  request: CatRequest;
  /** The setting's value in the answer, or null for an answer without one. */
  value(e: CatEvent): number | null;
  /** Read only once this holds: the KX2's menu numbers hold only on a KX2. */
  when?(s: RadioState): boolean;
  /** Read first, and the setting only when it says yes: the KX2's menu must not be in use. Not a refusal when it says no. */
  guard?: { request: CatRequest; ok(e: CatEvent): boolean };
}

export interface RadioTraits {
  id: CatRadioId;
  /** The radio's name on screen: "IC-705", "KX2". */
  name: string;
  /** The data mode RR73 sets, as the radio's screen names it: "USB-D", "DATA A". */
  dataModeName: string;
  /** After the frequency, the requests that set the data mode: USB-D, or DATA A. */
  dataMode: readonly CatRequest[];
  /** The reads of the mode, on connecting and every 5 s after the frequency. */
  modeReads: readonly CatRequest[];
  settings: readonly SettingRead[];
  /** Requests whose answer takes longer than the link's REPLY_MS, ms. */
  slow: Partial<Record<CatRequest['type'], number>>;
  /**
   * PTT on is confirmed by the read that follows it, and a read that says receive is read again
   * until PTT_TIMEOUT_MS: the KX2's TX has no answer of its own (Programmer's Reference p. 28).
   */
  readsPtt: boolean;
}

const setting = (e: CatEvent) => (e.type === 'setting' ? e.value : null);

/** The IC-705 over CI-V (docs/design/cat.md, Commands). */
export const IC705: RadioTraits = {
  id: 'ic705',
  name: 'IC-705',
  dataModeName: 'USB-D',
  dataMode: [
    { type: 'set_mode', mode: 'usb', filter: 1 },
    { type: 'set_data_mode', on: true, filter: 1 },
  ],
  modeReads: [{ type: 'read_mode' }, { type: 'read_data_mode' }],
  settings: (['usb_send', 'data_mod', 'time_out_timer'] as const).map((item) => ({ id: item, request: { type: 'read_setting', item }, value: setting })),
  slow: {},
  readsPtt: false,
};

/** The KX2's answer to OM that names it (Programmer's Reference p. 21). */
export const KX2_PRODUCT = 1;

/**
 * A band change takes about 0.5 s, and the KX2 handles no command until it is done (Programmer's
 * Reference p. 11, p. 3): the read-back of a frequency set waits this long, ms. Unverified on a
 * device.
 */
export const KX2_BAND_CHANGE_MS = 1000;

/** The Elecraft KX2 over its ACC jack, through a Digirig (docs/design/cat.md, Elecraft KX2). */
export const KX2: RadioTraits = {
  id: 'kx2',
  name: 'KX2',
  dataModeName: 'DATA A',
  // The frequency first, then the mode, so the mode applies on the new band (p. 5, note 2).
  dataMode: [
    { type: 'set_mode', mode: 'data' },
    { type: 'set_data_sub_mode', sub: 'data_a' },
  ],
  // DT is valid only in DATA (p. 11): the app reads it only there. VX is VOX in the present mode.
  modeReads: [{ type: 'read_mode' }, { type: 'read_data_sub_mode' }, { type: 'read_vox' }],
  settings: [
    { id: 'product', request: { type: 'read_options' }, value: (e) => (e.type === 'options' ? (e.product ?? 0) : null) },
    {
      id: 'mic_btn',
      request: { type: 'read_setting', item: 'mic_btn' },
      value: (e) => (e.type === 'menu_value' ? e.value : null),
      when: (s) => s.settings.product === KX2_PRODUCT,
      // Reading a menu setting opens its entry on the radio's screen and leaves the menu after
      // (p. 17). Not while the operator has a menu entry open.
      guard: { request: { type: 'read_menu_entry' }, ok: (e) => e.type === 'menu_entry' && e.entry === 255 },
    },
  ],
  slow: { set_frequency: KX2_BAND_CHANGE_MS },
  readsPtt: true,
};

export const RADIOS: Record<CatRadioId, RadioTraits> = { ic705: IC705, kx2: KX2 };
