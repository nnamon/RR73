/**
 * Custom exchange (Settings › FT8 and FT4): the text the operator would say on the air, such as
 * "6A WI", "WI" or "#" for a serial number, read into the parts each FT8 and FT4 exchange format
 * needs (docs/design/sequencer.md, Exchange formats). The formats are the codec's message types:
 * 0.3 and 0.4 (class and section), 3 (report with state, province or serial number) and 5
 * (report, serial number and 6-character grid). Standard messages carry grids and reports.
 */

import { STATUS } from './status';

/** The message format a QSO runs in: standard, or one of the codec's exchange types (i3.n3 0.3/0.4, 3 and 5). */
export type Format = 'standard' | 'fd' | 'ru' | 'vhf';

/**
 * ARRL and RAC sections the codec packs, in its code order (`SECTIONS` in
 * crates/rr73-ft8/src/message/fields.rs; exchange.test.ts holds the two lists equal).
 */
export const SECTIONS: readonly string[] = [
  'AB', 'AK', 'AL', 'AR', 'AZ', 'BC', 'CO', 'CT', 'DE', 'EB', 'EMA', 'ENY', 'EPA', 'EWA', 'GA', 'GH', 'IA',
  'ID', 'IL', 'IN', 'KS', 'KY', 'LA', 'LAX', 'NS', 'MB', 'MDC', 'ME', 'MI', 'MN', 'MO', 'MS', 'MT', 'NC',
  'ND', 'NE', 'NFL', 'NH', 'NL', 'NLI', 'NM', 'NNJ', 'NNY', 'TER', 'NTX', 'NV', 'OH', 'OK', 'ONE', 'ONN',
  'ONS', 'OR', 'ORG', 'PAC', 'PR', 'QC', 'RI', 'SB', 'SC', 'SCV', 'SD', 'SDG', 'SF', 'SFL', 'SJV', 'SK',
  'SNJ', 'STX', 'SV', 'TN', 'UT', 'VA', 'VI', 'VT', 'WCF', 'WI', 'WMA', 'WNY', 'WPA', 'WTX', 'WV', 'WWA',
  'WY', 'DX', 'PE', 'NB',
];

/** US states and Canadian provinces the codec packs, in its code order (`STATES` in fields.rs). */
export const STATES: readonly string[] = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY',
  'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND',
  'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'NB',
  'NS', 'QC', 'ON', 'MB', 'SK', 'AB', 'BC', 'NWT', 'NF', 'LB', 'NU', 'YT', 'PEI', 'DC',
];

/** Highest serial number of type 3 (the codec's RoundupExchange::MAX_SERIAL) and of type 5. */
export const MAX_SERIAL: Record<'ru' | 'vhf', number> = { ru: 7999, vhf: 2047 };

/** The parts found in the Custom exchange text. */
export interface ExchangeParts {
  /** Transmitters and class, such as "6A": 1 to 32 and A to H. */
  fdClass: string | null;
  /** An ARRL or RAC section, such as "WI". */
  section: string | null;
  /** A US state or Canadian province, such as "WI". */
  state: string | null;
  /** "#": send the serial number. */
  serial: boolean;
}

const CLASS = /^(\d{1,2})([A-H])$/;

/** Reads the Custom exchange text. Words that fit no part are ignored. */
export function readExchange(text: string): ExchangeParts {
  const words = text.trim().toUpperCase().split(/\s+/).filter(Boolean);
  const cls = words.find((w) => {
    const m = CLASS.exec(w);
    return !!m && Number(m[1]) >= 1 && Number(m[1]) <= 32;
  });
  const rest = words.filter((w) => w !== cls);
  return {
    fdClass: cls ? String(Number(cls.slice(0, -1))) + cls.slice(-1) : null,
    section: rest.find((w) => SECTIONS.includes(w)) ?? null,
    state: rest.find((w) => STATES.includes(w)) ?? null,
    serial: rest.includes('#'),
  };
}

/** True when the Custom exchange holds anything: the formats are on. */
export function exchangeOn(text: string | undefined | null): boolean {
  return !!text && text.trim().length > 0;
}

/**
 * The format a CQ's modifier names clearly: CQ FD (class and section) and CQ RU (report with
 * state, province or serial number). Any other CQ gets standard messages.
 */
export function cqFormat(modifier: string | null): Format {
  const m = modifier?.trim().toUpperCase();
  if (m === 'FD') return 'fd';
  if (m === 'RU') return 'ru';
  return 'standard';
}

/** The report digit of types 3 and 5, 2 to 9, from an SNR in dB: 4 dB a step, 7 at −10 dB. */
export function strength(snrDb: number): number {
  return Math.max(2, Math.min(9, Math.round((snrDb + 38) / 4)));
}

/** What our exchange sends in a format, as the words of the message after the callsigns (and R). */
export interface SentExchange {
  /** The words on air: "6A WI", "579 WI", "579 0013", "570013 OJ11AB". */
  text: string;
  /** The report as on air, for RST_SENT: "579", "57"; '' for class and section. */
  rst: string;
  /** The exchange without the report, for STX: "6A WI", "WI", "0013", "0013 OJ11AB". */
  stx: string;
  /** The serial number sent, or null. */
  serial: number | null;
}

/** Our exchange in `format`, or the status line notice that names what is missing. */
export function sentExchange(
  format: Exclude<Format, 'standard'>,
  parts: ExchangeParts,
  ctx: { serial: number; snrDb: number; grid: string },
): { ok: SentExchange } | { missing: string } {
  if (format === 'fd') {
    if (!parts.fdClass && !parts.section) return { missing: STATUS.exchangeClassSection };
    if (!parts.fdClass) return { missing: STATUS.exchangeClass };
    if (!parts.section) return { missing: STATUS.exchangeSection };
    const text = `${parts.fdClass} ${parts.section}`;
    return { ok: { text, rst: '', stx: text, serial: null } };
  }
  const s = strength(ctx.snrDb);
  if (format === 'ru') {
    const rst = `5${s}9`;
    if (parts.state) return { ok: { text: `${rst} ${parts.state}`, rst, stx: parts.state, serial: null } };
    if (!parts.serial) return { missing: STATUS.exchangeState };
    if (ctx.serial < 1 || ctx.serial > MAX_SERIAL.ru) return { missing: STATUS.serialRange };
    const n = String(ctx.serial).padStart(4, '0');
    return { ok: { text: `${rst} ${n}`, rst, stx: n, serial: ctx.serial } };
  }
  const grid = ctx.grid.trim().toUpperCase();
  if (!/^[A-R]{2}\d{2}[A-X]{2}$/.test(grid)) return { missing: STATUS.exchangeGrid };
  if (ctx.serial < 0 || ctx.serial > MAX_SERIAL.vhf) return { missing: STATUS.serialRange };
  const n = String(ctx.serial).padStart(4, '0');
  const rst = `5${s}`;
  return { ok: { text: `${rst}${n} ${grid}`, rst, stx: `${n} ${grid}`, serial: ctx.serial } };
}

/** An exchange received in one of the exchange formats. */
export interface ReceivedExchange {
  /** The report as on air, for RST_RCVD: "579", "57"; '' for class and section. */
  rst: string;
  /** The exchange without the report, for SRX: "17B EMA", "MA", "0013", "0007 JO22DB". */
  srx: string;
}
