/**
 * Operate in a keyboard mode (docs/design/rtty.md): the send queue and the transmission, the
 * received text, the QSO strip, macros, Repeat CQ, the idle stop and the watchdog. Mode-agnostic:
 * the modem lives in the keyboard worker, and the session reaches it and the audio output only
 * through its ports, so tests drive it with fakes.
 *
 * Typing never keys the radio. Return sends the line: from receive it starts a transmission
 * that returns to receive when the line is sent; on air it adds a line break and keeps
 * transmitting. A macro's text joins the queue at once, starting a transmission from receive.
 * The transmitter holds at most 0.4 s of text; the rest waits in the queue, where backspace can
 * still reach it. Each character leaves the queue and enters the received text, in the transmit
 * colour, as it goes to the transmitter.
 */

import { STATUS } from '../qso/status';
import type { LogQsoRecord } from '../log/types';
import { emptyDraft, editField, record, refill, setCall, FILL_WINDOW_MS, type Draft, type DraftKey } from './draft';
import { expand, queued, serialText, utc4, type FieldValues, type Macro, type MacroSetId } from './macros';
import type { CharTables, ModemEvent } from './modem';
import { otherCaseReader } from './modem';
import { SendQueue } from './queue';
import { Transcript, type CharKind, type Line } from './transcript';
import type { TxStream } from './client';

/** Text the transmitter holds at most, s. */
export const TX_AHEAD_S = 0.4;
/** Characters with a bit confidence under this print as uncertain. */
export const QUALITY_MIN = 0.5;
/** Audio rendered ahead of the output, s (protocol.ts AHEAD_S), counted in Rx in. */
const OUTPUT_AHEAD_S = 0.3;

export type TxState = 'off' | 'starting' | 'on' | 'ending';

/** What the session needs to know, read at each use. */
export interface SessionConfig {
  /** Seconds one character takes on the air. */
  charS: number;
  upperCaseOnly: boolean;
  newLineFirst: boolean;
  /** 0 is Off. */
  idleStopS: number;
  /** 0 is Off. */
  watchdogMin: number;
  repeatGapS: number;
  macros: readonly Macro[];
  set: MacroSetId;
  /** The station's fields: MYCALL, MYNAME, MYQTH, MYGRID. */
  myCall: string;
  myName: string;
  myQth: string;
  myGrid: string;
  exchange: string;
  nextSerial: number;
  serialDigits: number;
  contestId: string;
  /** For the log record. */
  mode: LogQsoRecord['mode'];
  band: string;
  dialHz: number;
  markHz: number;
}

export interface SessionPorts {
  now(): number;
  config(): SessionConfig;
  /** Opens the output and the transmitter; a status text when it cannot (audio off). */
  startTx(cb: { started(): void; drained(): void }): Promise<TxStream | string>;
  /** Logs a QSO; false when it was refused. */
  log(r: LogQsoRecord): Promise<boolean>;
  /** The serial number goes on by one after a Contest set QSO is logged. */
  stepSerial(): void;
}

type Mark = { kind: 'log' };

export class KeyboardSession {
  /** The send field: the queue as text. */
  field = $state('');
  tx = $state<TxState>('off');
  /** Audio queued in the transmitter, s. */
  queuedS = $state(0);
  lines = $state.raw<readonly Line[]>([]);
  draft = $state.raw<Draft>(emptyDraft());
  notice = $state<{ text: string; atMs: number } | null>(null);
  signal = $state<{ snrDb: number; squelchOpen: boolean } | null>(null);
  /** Receiver's tones, Hz: RTTY's mark and space. */
  tones = $state<number[]>([]);
  repeat = $state<{ on: boolean; nextAtMs: number | null }>({ on: false, nextAtMs: null });
  tables = $state.raw<CharTables>({ unsendable: '', otherCase: '' });
  /** Characters the field holds that the mode cannot send. */
  unsendable = $derived(new Set([...this.tables.unsendable]));

  private readonly queue = new SendQueue<Mark>();
  private readonly transcript = new Transcript();
  private stream: TxStream | null = null;
  /** The transmission ends once the queue is sent. */
  private endAfterQueue = false;
  private finishing = false;
  private lastActivityMs = 0;
  private lastTextMs = 0;
  private startGen = 0;
  /** Characters skipped in this transmission, each once, for the status line. */
  private notSent = '';
  /** Text handed to the transmitter and not yet read by takeSent, at most 2000 characters. */
  private sentBuf = '';

  constructor(private readonly ports: SessionPorts) {}

  private sync() {
    this.field = this.queue.text;
    this.lines = this.transcript.lines;
  }

  private say(text: string) {
    this.notice = { text, atMs: this.ports.now() };
  }

  private touch() {
    this.lastActivityMs = this.ports.now();
  }

  /** The other-case reading of text, from the modem's table. */
  readOtherCase(text: string): string {
    return otherCaseReader(this.tables)(text);
  }

  /** Seconds the queue takes on the air. */
  get queueS(): number {
    return this.queue.length * this.ports.config().charS;
  }

  /** Seconds until receive while ending: the queue, the transmitter and the audio ahead. */
  get rxInS(): number {
    return this.queueS + this.queuedS + OUTPUT_AHEAD_S;
  }

  // ---- Typing ----

  /** The operator's edit of the send field. Never keys the radio. */
  typed(value: string) {
    const c = this.ports.config();
    this.queue.edit(c.upperCaseOnly ? value.toUpperCase() : value);
    this.touch();
    this.stopRepeat();
    this.sync();
  }

  /** Return: sends the line. From receive it starts a transmission that ends after the line. */
  returnKey() {
    this.touch();
    this.stopRepeat();
    this.queue.append('\n');
    this.sync();
    if (this.tx === 'off') void this.start(true);
    else this.feed();
  }

  /** Empties the send field. Text already with the transmitter stays on air. */
  clearField() {
    this.queue.clear();
    this.touch();
    this.sync();
  }

  // ---- Macros ----

  /** The field values for macros now. */
  fieldValues(): FieldValues {
    const c = this.ports.config();
    const f = this.draft.fields;
    return {
      MYCALL: c.myCall,
      MYNAME: c.myName,
      MYQTH: c.myQth,
      MYGRID: c.myGrid,
      CALL: f.call,
      NAME: f.name,
      QTH: f.qth,
      RST: f.rstSent,
      NR: serialText(c.nextSerial, c.serialDigits),
      EXCH: c.exchange,
      UTC: utc4(this.ports.now()),
    };
  }

  /** The text a macro would send now, for Settings › Macros' Sends now. */
  preview(text: string): string {
    return expand(text, this.fieldValues()).text;
  }

  /** True when the stream being sent is at the start of a line. */
  private atLineStart(): boolean {
    if (this.queue.length) return this.queue.text.endsWith('\n');
    if (this.tx === 'off') return this.ports.config().newLineFirst || this.transcript.atLineStart;
    return this.transcript.atLineStart;
  }

  /** A tap on a macro: its text joins the queue at once; from receive it starts a transmission. */
  tapMacro(m: Macro, fromRepeat = false) {
    const c = this.ports.config();
    const { text, missing } = expand(m.text, this.fieldValues());
    if (missing.includes('CALL')) {
      this.say(STATUS.noCall);
      return;
    }
    if (missing.includes('MYCALL')) {
      this.say(STATUS.noMyCall);
      return;
    }
    if (!fromRepeat) {
      this.touch();
      this.stopRepeat();
    }
    const body = c.upperCaseOnly ? text.toUpperCase() : text;
    this.queue.append(queued(body, this.atLineStart()), m.logWhenSent ? { kind: 'log' } : undefined);
    this.sync();
    if (this.tx === 'off') void this.start(m.returnToRx);
    else {
      this.endAfterQueue = m.returnToRx;
      this.tx = m.returnToRx ? 'ending' : 'on';
      this.feed();
    }
  }

  // ---- Transmitting ----

  /** Tx in the bottom bar: starts; on air, ends after the queue; while ending, keeps going. */
  txButton() {
    this.touch();
    if (this.tx === 'off') {
      this.stopRepeat();
      void this.start(false);
    } else if (this.tx === 'on' || this.tx === 'starting') {
      this.endAfterQueue = true;
      if (this.tx === 'on') this.tx = 'ending';
      this.feed();
    } else if (!this.finishing) {
      this.endAfterQueue = false;
      this.tx = 'on';
    }
  }

  private async start(endAfterQueue: boolean) {
    if (this.tx !== 'off') return;
    const c = this.ports.config();
    if (!c.myCall) {
      this.say(STATUS.noMyCall);
      return;
    }
    this.tx = 'starting';
    this.endAfterQueue = endAfterQueue;
    this.finishing = false;
    this.notSent = '';
    this.queuedS = 0;
    const gen = ++this.startGen;
    const s = await this.ports.startTx({
      started: () => undefined,
      drained: () => {
        if (this.startGen === gen) this.ended();
      },
    });
    if (gen !== this.startGen) {
      if (typeof s !== 'string') s.stop();
      return;
    }
    if (typeof s === 'string') {
      this.tx = 'off';
      this.say(s);
      this.scheduleRepeat();
      return;
    }
    this.stream = s;
    this.tx = this.endAfterQueue ? 'ending' : 'on';
    this.lastTextMs = this.ports.now();
    if (c.newLineFirst) {
      s.text('\n');
      if (!this.transcript.atLineStart) this.transcript.add('\n', 't', this.ports.now());
      this.sync();
    }
    this.feed();
  }

  /** The transmitter's report after each block: feeds it from the queue. */
  txReport(queuedS: number) {
    this.queuedS = queuedS;
    this.feed();
  }

  /** Hands characters to the transmitter until it holds TX_AHEAD_S, and ends after the queue when asked. */
  private feed() {
    const s = this.stream;
    if (!s || this.finishing) return;
    const c = this.ports.config();
    if (this.queue.length && this.queuedS < TX_AHEAD_S) {
      const n = Math.max(1, Math.ceil((TX_AHEAD_S - this.queuedS) / c.charS));
      const { text, marks } = this.queue.take(n);
      const skipped = [...new Set([...text].filter((ch) => this.unsendable.has(ch)))];
      const send = [...text].filter((ch) => !this.unsendable.has(ch)).join('');
      if (skipped.length) {
        for (const ch of skipped) if (!this.notSent.includes(ch)) this.notSent += ch;
        this.say(STATUS.notSent([...this.notSent].join(' ')));
      }
      if (send) {
        s.text(send);
        this.sentBuf = (this.sentBuf + send).slice(-2000);
        const now = this.ports.now();
        for (const ch of send) this.transcript.add(ch, 't', now);
        this.lastTextMs = now;
        this.queuedS += send.length * c.charS;
      }
      this.sync();
      for (const m of marks) if (m.kind === 'log') void this.logQso();
    }
    if (!this.queue.length && this.endAfterQueue && this.queuedS <= c.charS) {
      this.finishing = true;
      this.tx = 'ending';
      s.finish();
    }
  }

  /** The output has played out: back to receive. */
  private ended() {
    this.stream = null;
    this.tx = 'off';
    this.finishing = false;
    this.queuedS = 0;
    this.scheduleRepeat();
  }

  /** Halt: silence at once, Repeat CQ off; the text not yet sent stays in the field. */
  halt() {
    this.startGen++;
    this.stream?.stop();
    this.stream = null;
    this.tx = 'off';
    this.finishing = false;
    this.queuedS = 0;
    this.repeat = { on: false, nextAtMs: null };
  }

  // ---- Repeat CQ ----

  /** The CQ macro of the set in use: the one labelled CQ, else the first. */
  cqMacro(): Macro | null {
    const ms = this.ports.config().macros;
    return ms.find((m) => m.label.trim().toUpperCase() === 'CQ') ?? ms[0] ?? null;
  }

  setRepeat(on: boolean) {
    this.touch();
    if (!on) {
      this.stopRepeat();
      return;
    }
    this.repeat = { on: true, nextAtMs: null };
    const m = this.cqMacro();
    if (m && this.tx === 'off') this.tapMacro(m, true);
  }

  private stopRepeat() {
    if (this.repeat.on) this.repeat = { on: false, nextAtMs: null };
  }

  private scheduleRepeat() {
    if (this.repeat.on) this.repeat = { on: true, nextAtMs: this.ports.now() + this.ports.config().repeatGapS * 1000 };
  }

  // ---- The 1 s tick: Repeat CQ, idle stop, watchdog ----

  tick() {
    const now = this.ports.now();
    const c = this.ports.config();
    const busy = this.tx !== 'off' || this.repeat.on;
    if (busy && c.watchdogMin > 0 && now - this.lastActivityMs >= c.watchdogMin * 60_000) {
      this.halt();
      this.say(STATUS.watchdog(c.watchdogMin));
      return;
    }
    if (this.tx === 'on' && c.idleStopS > 0 && !this.queue.length && now - this.lastTextMs >= c.idleStopS * 1000 + TX_AHEAD_S * 1000 + OUTPUT_AHEAD_S * 1000) {
      this.endAfterQueue = true;
      this.tx = 'ending';
      this.feed();
      this.say(STATUS.idleOff(idleText(c.idleStopS)));
      return;
    }
    if (this.repeat.on && this.tx === 'off' && this.repeat.nextAtMs !== null && now >= this.repeat.nextAtMs) {
      const m = this.cqMacro();
      this.repeat = { on: true, nextAtMs: null };
      if (m) this.tapMacro(m, true);
    }
  }

  // ---- Receiving ----

  /** The modem's events. Characters arriving while on air are dropped: the radio's own audio is no copy. */
  receive(events: readonly ModemEvent[]) {
    const now = this.ports.now();
    let printed = false;
    for (const e of events) {
      if (e.type === 'char') {
        if (this.tx !== 'off') continue;
        const uncertain = e.framingError || e.quality < QUALITY_MIN;
        if (this.transcript.add(e.ch, uncertain ? 'u' : 'r', now) && e.ch.trim()) printed = true;
      } else if (e.type === 'signal') this.signal = { snrDb: e.snrDb, squelchOpen: e.squelchOpen };
      else if (e.type === 'tones') this.tones = e.hz;
    }
    if (printed) {
      if (this.repeat.on && this.tx === 'off') this.stopRepeat();
      if (this.draft.fields.call) this.draft = refill(this.draft, this.recentRx(), this.ports.config().set === 'contest');
    }
    this.sync();
  }

  /** Text handed to the transmitter since the last call: what the practice band's stations hear. */
  takeSent(): string {
    const t = this.sentBuf;
    this.sentBuf = '';
    return t;
  }

  /** Text added as it is, one CharKind per character: the review build's received and sent text. */
  addText(text: string, kinds: string) {
    const now = this.ports.now();
    [...text].forEach((ch, i) => this.transcript.add(ch, (kinds[i] ?? 'r') as CharKind, now));
    this.sync();
  }

  /** A divider in the received text, such as "40m · 7.0400" at a change of band. */
  divider(text: string) {
    this.transcript.divider(text);
    this.sync();
  }

  clearText() {
    this.transcript.clear();
    this.sync();
  }

  private recentRx() {
    return this.transcript.rxSince(this.ports.now() - FILL_WINDOW_MS);
  }

  // ---- The QSO strip ----

  /** Sets the QSO's callsign and fills the strip from that station's text. */
  setCall(call: string, announce = true) {
    this.draft = setCall(this.draft, call, this.recentRx(), this.ports.now(), this.ports.config().set === 'contest');
    if (announce && this.draft.fields.call) this.say(STATUS.callSet(this.draft.fields.call));
  }

  /** The operator's value for a strip field. A typed callsign starts the QSO with that station. */
  editField(key: DraftKey, value: string) {
    if (key === 'call') {
      const call = value.toUpperCase().trim();
      if (call && call !== this.draft.fields.call) this.setCall(call, false);
      else if (!call) this.draft = emptyDraft();
      return;
    }
    this.draft = editField(this.draft, key, value);
  }

  /** Logs the strip; the strip clears and, in the Contest set, the serial number steps on. */
  async logQso(): Promise<boolean> {
    const d = this.draft;
    if (!d.fields.call) {
      this.say(STATUS.noCall);
      return false;
    }
    this.touch();
    const c = this.ports.config();
    const contest = c.set === 'contest';
    const r = record(d, { mode: c.mode, band: c.band, dialHz: c.dialHz, markHz: c.markHz, nowMs: this.ports.now(), contest, stx: serialText(c.nextSerial, c.serialDigits), contestId: c.contestId });
    const ok = await this.ports.log(r);
    if (!ok) return false;
    if (this.draft === d) this.draft = emptyDraft();
    if (contest) this.ports.stepSerial();
    return true;
  }

  /** The QSO sheet logged the strip: it clears, and in the Contest set the serial number steps on. */
  loggedFromSheet() {
    this.touch();
    this.draft = emptyDraft();
    if (this.ports.config().set === 'contest') this.ports.stepSerial();
  }

  /** Clears the strip without logging. */
  clearDraft() {
    this.draft = emptyDraft();
  }
}

/** "1 min", "30 s". */
function idleText(s: number): string {
  return s >= 60 && s % 60 === 0 ? `${s / 60} min` : `${s} s`;
}
