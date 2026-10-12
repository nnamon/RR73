/**
 * Hands slot files to the system share sheet where the browser allows sharing files, which on
 * iPhone includes saving to Files. Elsewhere it returns object URLs for download links.
 * Not tested on a device: whether a home-screen app may share files.
 */

import type { SlotFiles } from './recorder';

export interface DownloadLinks {
  wav: { name: string; url: string };
  json: { name: string; url: string };
  /** Releases the object URLs. */
  revoke(): void;
}

export type SaveResult = { kind: 'shared' } | { kind: 'cancelled' } | { kind: 'links'; links: DownloadLinks };

export function toFiles(f: SlotFiles): File[] {
  return [
    new File([f.wav], `${f.stem}.wav`, { type: 'audio/wav' }),
    new File([f.json], `${f.stem}.json`, { type: 'application/json' }),
  ];
}

export function downloadLinks(f: SlotFiles): DownloadLinks {
  const wav = URL.createObjectURL(new Blob([f.wav], { type: 'audio/wav' }));
  const json = URL.createObjectURL(new Blob([f.json], { type: 'application/json' }));
  return {
    wav: { name: `${f.stem}.wav`, url: wav },
    json: { name: `${f.stem}.json`, url: json },
    revoke() {
      URL.revokeObjectURL(wav);
      URL.revokeObjectURL(json);
    },
  };
}

/** Call from a tap: the share sheet needs the tap's user activation. */
export async function saveSlot(f: SlotFiles, nav: Navigator = navigator): Promise<SaveResult> {
  const files = toFiles(f);
  if (typeof nav.canShare === 'function' && typeof nav.share === 'function' && nav.canShare({ files })) {
    try {
      await nav.share({ files, title: `Slot ${f.stem}` });
      return { kind: 'shared' };
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return { kind: 'cancelled' };
      // A refusal (NotAllowedError, for one) falls through to download links.
    }
  }
  return { kind: 'links', links: downloadLinks(f) };
}
