/**
 * RTTY stations on the practice band: JA1XYZ calls CQ and works the operator with name and QTH,
 * DL5ABC answers the operator's CQ, and OH2BAX calls CQ TEST and gives a contest exchange. They
 * listen while the operator transmits and answer 2 s after the operator's transmission ends,
 * reading what the operator sent, as a station on the air would.
 */

/** One transmission to start: text at a mark tone, Hz, at an SNR in 3000 Hz, dB. */
export interface RttyTransmission {
  call: string;
  text: string;
  markHz: number;
  snrDb: number;
}

interface Station {
  call: string;
  markHz: number;
  snrDb: number;
  name: string;
  qth: string;
  /** Calls CQ every this many ms while it has nobody to work; null for a station that only answers. */
  cqEveryMs: number | null;
  contest: boolean;
  /** Where it stands with the operator. */
  state: 'idle' | 'called' | 'report' | 'done';
  nextCqMs: number;
  /** Busy sending until then, UTC ms. */
  busyUntilMs: number;
  serial: number;
}

/** RTTY on the air at 45.45 baud: 165 ms a character. */
const CHAR_MS = 165;
/** A station answers this long after the operator's transmission ends, ms. */
const REPLY_MS = 2000;

function station(call: string, markHz: number, snrDb: number, name: string, qth: string, cqEveryMs: number | null, contest = false, serial = 1): Station {
  return { call, markHz, snrDb, name, qth, cqEveryMs, contest, state: 'idle', nextCqMs: 0, busyUntilMs: 0, serial };
}

export class RttyStations {
  private readonly stations: Station[];
  /** The operator's text since their transmission started. */
  private heard = '';
  private wasOnAir = false;
  private replyAtMs: number | null = null;

  constructor(
    private readonly myCall: string,
    startMs: number,
  ) {
    this.stations = [
      station('JA1XYZ', 1612, 4, 'TARO', 'YOKOHAMA', 40_000),
      station('OH2BAX', 2240, -2, 'PEKKA', 'ESPOO', 25_000, true, 877),
      station('DL5ABC', 905, 0, 'HANS', 'MUNICH', null),
    ];
    this.stations.forEach((s, i) => (s.nextCqMs = startMs + 3000 + i * 9000));
  }

  /** Text the operator handed to the transmitter. */
  sent(text: string) {
    this.heard += text.toUpperCase();
  }

  /**
   * The transmissions to start at `nowMs`: CQs that are due, and answers once the operator's
   * transmission has ended. Nothing starts while the operator is on air.
   */
  due(nowMs: number, onAir: boolean): RttyTransmission[] {
    const out: RttyTransmission[] = [];
    if (onAir) {
      this.wasOnAir = true;
      this.replyAtMs = null;
      return out;
    }
    if (this.wasOnAir) {
      this.wasOnAir = false;
      this.replyAtMs = nowMs + REPLY_MS;
    }
    if (this.replyAtMs !== null && nowMs >= this.replyAtMs) {
      this.replyAtMs = null;
      out.push(...this.answers(nowMs, this.heard));
      this.heard = '';
    }
    // While an answer to the operator is pending, the band listens.
    if (this.replyAtMs !== null) return out;
    for (const s of this.stations) {
      if (s.cqEveryMs === null || s.state === 'called' || s.state === 'report' || nowMs < s.nextCqMs || nowMs < s.busyUntilMs) continue;
      if (out.some((t) => t.call === s.call)) continue;
      const text = s.contest ? `CQ TEST ${s.call} ${s.call} CQ` : `CQ CQ CQ DE ${s.call} ${s.call} ${s.call}\nPSE K`;
      out.push(this.send(s, text, nowMs));
      s.nextCqMs = nowMs + s.cqEveryMs;
    }
    return out;
  }

  private send(s: Station, text: string, nowMs: number): RttyTransmission {
    s.busyUntilMs = nowMs + (text.length + 6) * CHAR_MS;
    return { call: s.call, text: `\n${text}\n`, markHz: s.markHz, snrDb: s.snrDb };
  }

  /** What the stations say to the operator's last transmission. */
  private answers(nowMs: number, text: string): RttyTransmission[] {
    const me = this.myCall.toUpperCase();
    if (!me || !text.trim()) return [];
    const has = (w: string) => new RegExp(`(^|[^A-Z0-9/])${w}($|[^A-Z0-9/])`).test(text);
    const out: RttyTransmission[] = [];
    // A station named in the text answers, and so does one already in a QSO with the operator.
    for (const s of this.stations) {
      if (has(s.call) || s.state === 'called' || s.state === 'report') {
        const t = this.reply(s, text, me);
        if (t) out.push(this.send(s, t, nowMs));
      }
    }
    // A CQ from the operator with nobody named: DL5ABC answers.
    const caller = this.stations.find((s) => s.cqEveryMs === null)!;
    if (!out.length && /\bCQ\b/.test(text) && has(me) && caller.state !== 'done') {
      caller.state = 'called';
      out.push(this.send(caller, `${me} ${me} DE ${caller.call} ${caller.call} K`, nowMs));
    }
    return out;
  }

  private reply(s: Station, text: string, me: string): string | null {
    const ending = /\b(73|SK|TU)\b/.test(text);
    if (s.contest) {
      if (s.state === 'report' && /\bTU\b/.test(text)) {
        s.state = 'done';
        s.nextCqMs = 0;
        return `TU ${s.call} TEST`;
      }
      if (s.state === 'done') return null;
      s.state = 'report';
      const nr = String(s.serial++).padStart(4, '0');
      return `${me} 599 ${nr} ${nr}`;
    }
    if (s.state === 'report' && ending) {
      s.state = 'done';
      s.nextCqMs = Number.POSITIVE_INFINITY;
      return `R R TNX FER QSO. 73 ES GL\n${me} DE ${s.call} SK`;
    }
    if (s.state === 'done') return null;
    s.state = 'report';
    return `${me} DE ${s.call}\nGE OM TNX FER CALL. UR RST 579 579\nNAME ${s.name} ${s.name} QTH ${s.qth} ${s.qth}\nHW CPY? ${me} DE ${s.call} K`;
  }
}
