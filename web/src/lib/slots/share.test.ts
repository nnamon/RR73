import { describe, expect, it, vi } from 'vitest';
import { saveSlot, toFiles } from './share';
import type { SlotFiles } from './recorder';

const FILES: SlotFiles = { stem: '261013_131415', wav: new Uint8Array([1, 2, 3]), json: '{}\n' };

function nav(over: Partial<Navigator>): Navigator {
  return over as Navigator;
}

describe('saveSlot', () => {
  it('names the files by the slot stem', () => {
    expect(toFiles(FILES).map((f) => [f.name, f.type])).toEqual([
      ['261013_131415.wav', 'audio/wav'],
      ['261013_131415.json', 'application/json'],
    ]);
  });

  it('uses the share sheet when the browser can share files', async () => {
    const share = vi.fn(async () => undefined);
    const r = await saveSlot(FILES, nav({ canShare: () => true, share }));
    expect(r).toEqual({ kind: 'shared' });
    expect(share).toHaveBeenCalledOnce();
    const arg = (share.mock.calls[0] as unknown as [ShareData])[0];
    expect(arg.files?.map((f) => f.name)).toEqual(['261013_131415.wav', '261013_131415.json']);
  });

  it('reports a cancelled share sheet', async () => {
    const share = vi.fn(async () => {
      throw new DOMException('cancelled', 'AbortError');
    });
    expect(await saveSlot(FILES, nav({ canShare: () => true, share }))).toEqual({ kind: 'cancelled' });
  });

  it('returns download links when files cannot be shared', async () => {
    for (const n of [nav({}), nav({ canShare: () => false, share: vi.fn() })]) {
      const r = await saveSlot(FILES, n);
      expect(r.kind).toBe('links');
      if (r.kind !== 'links') return;
      expect(r.links.wav.name).toBe('261013_131415.wav');
      expect(r.links.json.name).toBe('261013_131415.json');
      expect(r.links.wav.url).toMatch(/^blob:/);
      r.links.revoke();
    }
  });

  it('falls back to links when sharing is refused', async () => {
    const share = vi.fn(async () => {
      throw new DOMException('no', 'NotAllowedError');
    });
    expect((await saveSlot(FILES, nav({ canShare: () => true, share }))).kind).toBe('links');
  });
});
