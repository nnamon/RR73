// QSP's audio frames (docs/design/qsp.md, The audio stream): one per WebSocket message,
// big-endian. crates/rr73-qsp/src/frame.rs writes them; both read fixtures/qsp.

/** Samples per second in every frame. */
export const FRAME_RATE = 12000;
/** The frame's time comes from the receiver's GPS. */
export const FLAG_GPS = 1;
/** Audio is missing before this frame. */
export const FLAG_GAP = 2;

const HEADER = 20;

const STEPS = [
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371,
  408, 449, 494, 544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132,
  7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767,
];
const INDEX_STEP = [-1, -1, -1, -1, 2, 4, 6, 8];

export interface QspFrame {
  seq: number;
  /** UTC of the first sample, ms (with a fraction). */
  utcMs: number;
  flags: number;
  /** Samples at 12 kHz, full scale ±1. */
  samples: Float32Array;
}

/** Reads one frame; null when it is short, of another version or of an unknown encoding. */
export function decodeFrame(buf: ArrayBuffer): QspFrame | null {
  if (buf.byteLength < HEADER) return null;
  const v = new DataView(buf);
  if (v.getUint8(0) !== 1) return null;
  const encoding = v.getUint8(1);
  const flags = v.getUint16(2);
  const seq = v.getUint32(4);
  const utcUs = v.getBigInt64(8);
  const n = v.getUint32(16);
  const out = new Float32Array(n);
  if (encoding === 0) {
    if (buf.byteLength < HEADER + 2 * n) return null;
    for (let i = 0; i < n; i++) out[i] = v.getInt16(HEADER + 2 * i) / 32768;
  } else if (encoding === 1) {
    if (buf.byteLength < HEADER + 4 + Math.ceil(n / 2)) return null;
    let pred = v.getInt16(HEADER);
    let index = Math.min(88, v.getUint8(HEADER + 2));
    for (let i = 0; i < n; i++) {
      const byte = v.getUint8(HEADER + 4 + (i >> 1));
      const code = i & 1 ? byte >> 4 : byte & 0x0f;
      const step = STEPS[index];
      let d = step >> 3;
      if (code & 4) d += step;
      if (code & 2) d += step >> 1;
      if (code & 1) d += step >> 2;
      pred = Math.max(-32768, Math.min(32767, code & 8 ? pred - d : pred + d));
      index = Math.max(0, Math.min(88, index + INDEX_STEP[code & 7]));
      out[i] = pred / 32768;
    }
  } else return null;
  return { seq, utcMs: Number(utcUs) / 1000, flags, samples: out };
}
