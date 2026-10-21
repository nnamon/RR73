/**
 * Rig control requests and events as the app handles them, in the JSON form of rr73-wasm's CAT
 * exports, and the codecs that turn them into bytes and back: CI-V for the IC-705
 * (crates/rr73-wasm/src/cat.rs) and Elecraft's text commands for the KX2
 * (crates/rr73-wasm/src/cat_kx2.rs). The protocols live in the rr73-cat crate; this file only
 * names their JSON and loads the WebAssembly module on the main thread, where the serial port is.
 */

/**
 * Operating modes, as the crate writes them: the IC-705's (CI-V guide p. 17) and the KX2's
 * (Programmer's Reference p. 16), which adds DATA, CW-REV and DATA-REV.
 */
export type CatMode = 'lsb' | 'usb' | 'am' | 'cw' | 'rtty' | 'fm' | 'wfm' | 'cw-r' | 'rtty-r' | 'dv' | 'data' | 'cw-rev' | 'data-rev';

/** The KX2's data sub-modes (Programmer's Reference p. 11): DATA A, AFSK A, FSK D, PSK D. */
export type DataSub = 'data_a' | 'afsk_a' | 'fsk_d' | 'psk_d';

/** IF filter: FIL1, FIL2 or FIL3. */
export type CatFilter = 1 | 2 | 3;

/** The menu settings RR73 reads: the IC-705's (CI-V guide pp. 6 and 8) and the KX2's MIC BTN (Programmer's Reference p. 19). */
export type MenuItemId = 'time_out_timer' | 'data_off_mod' | 'data_mod' | 'usb_send' | 'civ_transceive' | 'civ_usb_echo_back' | 'mic_btn';

/**
 * What RR73 reads and shows under Radio settings: the menu settings; split (0 off, 1 on, and on the
 * IC-705 2 DUP− and 3 DUP+), RIT and XIT (1 on) and their shared offset in Hz, from the IC-705's
 * `0F` and `21` and the KX2's `IF`; and the KX2's product number (`OM`), VOX (`VX`, 1 on), K2
 * command mode (`K2`), receive filter bandwidth in Hz (`BW`) and the menu entry shown (`MN`, 255
 * with none).
 */
export type SettingId = MenuItemId | 'product' | 'vox' | 'k2' | 'auto_info' | 'split' | 'rit' | 'xit' | 'offset_hz' | 'bandwidth' | 'menu_entry';

/** The IC-705's split and duplex, as `0F` reads them (CI-V guide p. 3). */
export type CatSplit = 'off' | 'on' | 'dup_minus' | 'dup_plus';

export type CatRequest =
  | { type: 'read_frequency' }
  | { type: 'set_frequency'; hz: number }
  | { type: 'read_mode' }
  | { type: 'set_mode'; mode: CatMode; filter?: CatFilter }
  | { type: 'read_data_mode' }
  | { type: 'set_data_mode'; on: boolean; filter?: CatFilter }
  | { type: 'read_data_sub_mode' }
  | { type: 'set_data_sub_mode'; sub: DataSub }
  | { type: 'read_transmit' }
  | { type: 'set_transmit'; on: boolean }
  | { type: 'read_setting'; item: MenuItemId }
  | { type: 'read_options' }
  | { type: 'read_vox' }
  | { type: 'read_menu_entry' }
  | { type: 'leave_menu' }
  | { type: 'read_info' }
  | { type: 'read_bandwidth' }
  | { type: 'read_k2_mode' }
  | { type: 'read_auto_info' }
  | { type: 'read_split' }
  | { type: 'read_rit_offset' }
  | { type: 'read_rit' }
  | { type: 'read_xit' };

export type CatEvent =
  | { type: 'ok' }
  | { type: 'ng' }
  | { type: 'frequency'; hz: number; transceive: boolean }
  | { type: 'mode'; mode: CatMode; filter?: CatFilter | null; transceive: boolean }
  | { type: 'data_mode'; on: boolean; filter: CatFilter | null }
  | { type: 'transmit'; on: boolean }
  | { type: 'setting'; item: MenuItemId; value: number }
  | { type: 'echo'; command: number }
  | { type: 'other_address'; to: number; from: number; command: number }
  | { type: 'unknown'; command: number | string; data?: number[] }
  | { type: 'malformed'; command: number | string; fault: string }
  | { type: 'noise'; bytes: number }
  | { type: 'vfo_frequency'; vfo: string; hz: number }
  | { type: 'vfo_mode'; vfo: string; mode: CatMode; data: boolean | null; filter: CatFilter | null }
  | { type: 'data_sub_mode'; sub: DataSub }
  | { type: 'info'; hz: number; mode: CatMode | null; transmit: boolean; rit: boolean; xit: boolean; offset_hz: number; split: boolean }
  | { type: 'bandwidth'; hz: number }
  | { type: 'k2_mode'; mode: number }
  | { type: 'auto_info'; mode: number }
  | { type: 'options'; product: number | null; modules: string }
  | { type: 'vox'; on: boolean }
  | { type: 'menu_entry'; entry: number }
  | { type: 'menu_value'; value: number }
  | { type: 'busy' }
  | { type: 'split'; split: CatSplit }
  | { type: 'rit_offset'; hz: number }
  | { type: 'rit'; on: boolean }
  | { type: 'xit'; on: boolean };

/** The IC-705's CI-V address unless the operator changed it (CI-V guide p. 2). */
export const IC705_ADDRESS = 0xa4;

/** Requests to bytes, bytes to events, and which event answers which request. */
export interface CatCodec {
  /** The bytes of a request. Throws for a request the crate refuses (a frequency it cannot carry). */
  encode(r: CatRequest): Uint8Array;
  /** The events the bytes complete, oldest first. Keeps a frame or answer cut across chunks. */
  parse(bytes: Uint8Array): CatEvent[];
  /** Forgets a frame or answer in progress, as after reopening the port. */
  reset(): void;
  /** True when `e` answers `r`: OK for a set, the data for a read, NG or `?;` for either. */
  answers(r: CatRequest, e: CatEvent): boolean;
  /**
   * True when `e`, an answer to `r`, says the radio did what `r` asked: OK for a CI-V set, the
   * data for a read, a read-back equal to the set for an Elecraft set. False for NG, `?;` and a
   * garbled answer.
   */
  accepts(r: CatRequest, e: CatEvent): boolean;
  /**
   * True for an answer that carries no command and may come before more answers to the same
   * request: Elecraft's `?;`. The link drops answers for a while after it, so a late one is never
   * taken for the answer to a later request.
   */
  drains(e: CatEvent): boolean;
}

/** The parts of rr73-wasm the codecs use. */
export interface CatWasm {
  cat_encode(requestJson: string, radio: number): Uint8Array;
  cat_answers(requestJson: string, eventJson: string): boolean;
  CatParser: new (radio: number) => { push(bytes: Uint8Array): string; reset(): void };
  cat_kx2_encode(requestJson: string): Uint8Array;
  cat_kx2_answers(requestJson: string, eventJson: string): boolean;
  cat_kx2_accepts(requestJson: string, eventJson: string): boolean;
  CatKx2Parser: new () => { push(bytes: Uint8Array): string; reset(): void };
}

const isSet = (r: CatRequest) => r.type.startsWith('set_');

/** A CI-V codec over rr73-wasm for the radio at `address`. */
export function wasmCodec(wasm: CatWasm, address = IC705_ADDRESS): CatCodec {
  const parser = new wasm.CatParser(address);
  return {
    encode: (r) => wasm.cat_encode(JSON.stringify(r), address),
    parse: (bytes) => JSON.parse(parser.push(bytes)) as CatEvent[],
    reset: () => parser.reset(),
    answers: (r, e) => wasm.cat_answers(JSON.stringify(r), JSON.stringify(e)),
    accepts: (r, e) => e.type !== 'ng' && e.type !== 'malformed' && (!isSet(r) || e.type === 'ok'),
    drains: () => false,
  };
}

/** An Elecraft codec over rr73-wasm, for the KX2. */
export function kx2Codec(wasm: CatWasm): CatCodec {
  const parser = new wasm.CatKx2Parser();
  return {
    encode: (r) => wasm.cat_kx2_encode(JSON.stringify(r)),
    parse: (bytes) => JSON.parse(parser.push(bytes)) as CatEvent[],
    reset: () => parser.reset(),
    answers: (r, e) => wasm.cat_kx2_answers(JSON.stringify(r), JSON.stringify(e)),
    accepts: (r, e) => wasm.cat_kx2_accepts(JSON.stringify(r), JSON.stringify(e)),
    drains: (e) => e.type === 'busy',
  };
}

type Module = CatWasm & { default: (input?: unknown) => Promise<unknown> };

// Optional at build time, as in the workers: src/wasm/pkg is built by wasm-pack and git-ignored.
const modules = import.meta.glob<Module>('../../wasm/pkg/rr73_wasm.js');
const loader = Object.values(modules)[0] ?? null;
let loading: Promise<CatWasm | null> | null = null;

/** rr73-wasm on the main thread, loaded once; null in a build without it or when it fails to load. */
export function loadCatWasm(): Promise<CatWasm | null> {
  loading ??= (async () => {
    if (!loader) return null;
    try {
      const m = await loader();
      await m.default();
      return m;
    } catch {
      loading = null;
      return null;
    }
  })();
  return loading;
}
