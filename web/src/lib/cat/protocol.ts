/**
 * CI-V requests and events as the app handles them, in the JSON form of rr73-wasm's CAT exports
 * (crates/rr73-wasm/src/cat.rs), and the codec that turns them into bytes and back. The protocol
 * lives in the rr73-cat crate; this file only names its JSON and loads the WebAssembly module on
 * the main thread, where the serial port is.
 */

/** Operating modes (CI-V guide p. 17), as the crate writes them. */
export type CatMode = 'lsb' | 'usb' | 'am' | 'cw' | 'rtty' | 'fm' | 'wfm' | 'cw-r' | 'rtty-r' | 'dv';

/** IF filter: FIL1, FIL2 or FIL3. */
export type CatFilter = 1 | 2 | 3;

/** The menu settings RR73 reads (CI-V guide pp. 6 and 8). */
export type MenuItemId = 'time_out_timer' | 'data_off_mod' | 'data_mod' | 'usb_send' | 'civ_transceive' | 'civ_usb_echo_back';

export type CatRequest =
  | { type: 'read_frequency' }
  | { type: 'set_frequency'; hz: number }
  | { type: 'read_mode' }
  | { type: 'set_mode'; mode: CatMode; filter?: CatFilter }
  | { type: 'read_data_mode' }
  | { type: 'set_data_mode'; on: boolean; filter?: CatFilter }
  | { type: 'read_transmit' }
  | { type: 'set_transmit'; on: boolean }
  | { type: 'read_setting'; item: MenuItemId };

export type CatEvent =
  | { type: 'ok' }
  | { type: 'ng' }
  | { type: 'frequency'; hz: number; transceive: boolean }
  | { type: 'mode'; mode: CatMode; filter: CatFilter | null; transceive: boolean }
  | { type: 'data_mode'; on: boolean; filter: CatFilter | null }
  | { type: 'transmit'; on: boolean }
  | { type: 'setting'; item: MenuItemId; value: number }
  | { type: 'echo'; command: number }
  | { type: 'other_address'; to: number; from: number; command: number }
  | { type: 'unknown'; command: number; data: number[] }
  | { type: 'malformed'; command: number; fault: string }
  | { type: 'noise'; bytes: number }
  | { type: 'vfo_frequency'; vfo: string; hz: number }
  | { type: 'vfo_mode'; vfo: string; mode: CatMode; data: boolean | null; filter: CatFilter | null };

/** The IC-705's CI-V address unless the operator changed it (CI-V guide p. 2). */
export const IC705_ADDRESS = 0xa4;

/** Frames to bytes, bytes to events, and which event answers which request. */
export interface CatCodec {
  /** The bytes of a request. Throws for a request the crate refuses (a frequency above 499.999999 MHz). */
  encode(r: CatRequest): Uint8Array;
  /** The events the bytes complete, oldest first. Keeps a frame cut across chunks. */
  parse(bytes: Uint8Array): CatEvent[];
  /** Forgets a frame in progress, as after reopening the port. */
  reset(): void;
  /** True when `e` answers `r`: OK for a set, the data for a read, NG for either. */
  answers(r: CatRequest, e: CatEvent): boolean;
}

/** The parts of rr73-wasm the codec uses. */
export interface CatWasm {
  cat_encode(requestJson: string, radio: number): Uint8Array;
  cat_answers(requestJson: string, eventJson: string): boolean;
  CatParser: new (radio: number) => { push(bytes: Uint8Array): string; reset(): void };
}

/** A codec over rr73-wasm for the radio at `address`. */
export function wasmCodec(wasm: CatWasm, address = IC705_ADDRESS): CatCodec {
  const parser = new wasm.CatParser(address);
  return {
    encode: (r) => wasm.cat_encode(JSON.stringify(r), address),
    parse: (bytes) => JSON.parse(parser.push(bytes)) as CatEvent[],
    reset: () => parser.reset(),
    answers: (r, e) => wasm.cat_answers(JSON.stringify(r), JSON.stringify(e)),
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
