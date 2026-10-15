// The CI-V exports of rr73-wasm (crates/rr73-wasm/src/cat.rs) as the app calls them: JSON
// requests to bytes, bytes from the port to JSON events. Frames follow Icom's IC-705 CI-V
// Reference Guide, A7560-8EX-6 (p. 2 layout, p. 14 transmit, p. 17 frequency).
import { describe, expect, it } from 'vitest';
import { loadWasm } from '../../../e2e/wasm';

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0').toUpperCase()).join(' ');

describe('CI-V through the WebAssembly exports', () => {
  it('turns requests into the bytes for the radio', async () => {
    const wasm = await loadWasm();
    expect(wasm, 'the wasm package in src/wasm/pkg').not.toBeNull();
    if (!wasm) return;
    const bytes = wasm.cat_encode(JSON.stringify({ type: 'set_frequency', hz: 14_074_000 }), 0xa4);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(hex(bytes)).toBe('FE FE A4 E0 05 00 40 07 14 00 FD');
    expect(hex(wasm.cat_encode('{"type":"set_transmit","on":true}', 0xa4))).toBe('FE FE A4 E0 1C 00 01 FD');
    expect(hex(wasm.cat_encode('{"type":"set_data_mode","on":true,"filter":1}', 0xa4))).toBe('FE FE A4 E0 1A 06 01 01 FD');
    // Errors throw.
    expect(() => wasm.cat_encode('{"type":"set_frequency","hz":500000000}', 0xa4)).toThrow(/499\.999999 MHz/);
    expect(() => wasm.cat_encode('{"type":"set_data_mode","on":true}', 0xa4)).toThrow(/filter/);
  });

  it('reads the radio’s bytes in any chunks and says which request they answer', async () => {
    const wasm = await loadWasm();
    if (!wasm) return;
    const parser = new wasm.CatParser(0xa4);
    expect(parser.radio_address).toBe(0xa4);
    const reply = Uint8Array.from([0xfe, 0xfe, 0xe0, 0xa4, 0x03, 0x00, 0x40, 0x07, 0x14, 0x00, 0xfd]);
    expect(JSON.parse(parser.push(reply.subarray(0, 5)))).toEqual([]);
    const events = JSON.parse(parser.push(reply.subarray(5))) as { type: string }[];
    expect(events).toEqual([{ type: 'frequency', hz: 14_074_000, transceive: false }]);
    expect(wasm.cat_answers('{"type":"read_frequency"}', JSON.stringify(events[0]))).toBe(true);
    expect(wasm.cat_answers('{"type":"read_transmit"}', JSON.stringify(events[0]))).toBe(false);
    // An echo of our own frame, then OK.
    const echoThenOk = Uint8Array.from([0xfe, 0xfe, 0xa4, 0xe0, 0x1c, 0x00, 0x01, 0xfd, 0xfe, 0xfe, 0xe0, 0xa4, 0xfb, 0xfd]);
    const two = JSON.parse(parser.push(echoThenOk)) as unknown[];
    expect(two).toEqual([{ type: 'echo', command: 0x1c }, { type: 'ok' }]);
    expect(wasm.cat_answers('{"type":"set_transmit","on":true}', JSON.stringify(two[0]))).toBe(false);
    expect(wasm.cat_answers('{"type":"set_transmit","on":true}', JSON.stringify(two[1]))).toBe(true);
    expect(JSON.parse(parser.push(Uint8Array.from([0x41, 0x42])))).toEqual([{ type: 'noise', bytes: 2 }]);
    parser.free();
  });
});
