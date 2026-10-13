// Spots from the POTA API and the DX cluster, normalised to one shape whatever the source.

/** Programmes a spot can name a reference of. */
export const PROGRAMMES = ['POTA', 'SOTA', 'WWFF', 'IOTA'] as const;
export type Programme = (typeof PROGRAMMES)[number];

/** What a spot is for the filters: a programme, or DX for a spot without a reference. */
export type SpotClass = Programme | 'DX';
export const SPOT_CLASSES: readonly SpotClass[] = [...PROGRAMMES, 'DX'];

/** A park, summit, WWFF area or island group, such as POTA VK-0921. */
export interface SpotRef {
  programme: Programme;
  /** Upper case, as published: VK-0921, VK3/VC-012, VKFF-0921, OC-001. */
  ref: string;
  /** Park or summit name; '' when the source gave none. */
  name: string;
}

/** Where spots come from. sota holds SOTA's place: its source is not implemented. */
export type SourceId = 'pota' | 'hamqth' | 'sota';

/** The modes RR73 can work. */
export type DigitalMode = 'FT8' | 'FT4';

/** One spot. Text fields hold '' when the source gave nothing. */
export interface Spot {
  /** The source and its id for the spot, such as pota:58617948. */
  id: string;
  source: SourceId;
  /** Spotted callsign, upper case, as spotted: W7QRP/P. */
  activator: string;
  /** References the spot names; empty for a DX spot. */
  refs: SpotRef[];
  /** DXCC entity name from the cluster, such as New Zealand; '' from the POTA API. */
  country: string;
  /** Frequency, Hz, or null when the spot has none that can be read. */
  freqHz: number | null;
  /** ADIF band from the frequency, such as 20m; null outside the amateur bands. */
  band: string | null;
  /** Mode as spotted, upper case: FT8, CW, SSB, DIGI; '' when none. */
  mode: string;
  /** FT8 or FT4 from the mode, the comments or the frequency (see digital.ts). */
  digital: DigitalMode | null;
  /** When the spot was made, UTC ms. */
  spottedAt: number;
  /** Spotter callsign, upper case, without a skimmer's -# suffix. */
  spotter: string;
  /** True for a spot from a skimmer (the Reverse Beacon Network). */
  automatic: boolean;
  /** SNR a skimmer reported, dB; null for spots made by people. */
  snrDb: number | null;
  /** True when the comments say the station has gone QRT. */
  qrt: boolean;
  comments: string;
}

/** The classes of a spot: its programmes, or DX. */
export function spotClasses(s: Spot): SpotClass[] {
  if (!s.refs.length) return ['DX'];
  return PROGRAMMES.filter((p) => s.refs.some((r) => r.programme === p));
}

/** A tag on a spot row from outside the feed, such as New park from the log. */
export interface SpotBadge {
  text: string;
  /** teal for news, muted for worked or QRT. */
  tone: 'teal' | 'muted';
}

/** Why a request for spots failed. */
export type SpotErrorKind = 'network' | 'timeout' | 'http' | 'format';

/** A failed request. The message is for logs; screens build their text from `kind`. */
export class SpotFetchError extends Error {
  constructor(
    readonly kind: SpotErrorKind,
    /** HTTP status for kind http. */
    readonly status: number | null = null,
    /** The timeout that expired for kind timeout, ms. */
    readonly afterMs: number | null = null,
  ) {
    super(`Spot request failed: ${kind}${status === null ? '' : ` ${status}`}`);
    this.name = 'SpotFetchError';
  }
}

/** A spot feed. */
export interface SpotSource {
  readonly id: SourceId;
  /** The name screens use: POTA, HamQTH. */
  readonly name: string;
  /** The classes its spots can have, for the filter chips. */
  readonly classes: readonly SpotClass[];
  /** Credit the source asks apps to show, or null. */
  readonly credit: string | null;
  /**
   * Fetches and normalises the current spots. Rejects with a SpotFetchError, or with an
   * AbortError when `signal` aborts.
   */
  fetch(signal: AbortSignal): Promise<Spot[]>;
}

/** What normalising one response gave: the spots, and how many records were dropped. */
export interface Normalised {
  spots: Spot[];
  /** Records without a callsign, a time or a usable shape, or marked invalid. */
  skipped: number;
}
