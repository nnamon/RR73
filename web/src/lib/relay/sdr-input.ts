/**
 * A web SDR through a QSP relay as a capture input (docs/design/qsp.md). QSP stamps each frame
 * with the UTC of its first sample. A frame plays PLAYOUT_S after that time on the audio clock,
 * which leaves room for the network's jitter, and the input's offset takes those seconds back off
 * capture's timestamps: the decoder sees each sample at the time QSP gave it. Contiguous frames
 * keep one mapping from UTC to the audio clock, so they join sample for sample; the mapping is set
 * again after a gap, or when it has drifted 20 ms from the clocks. The node goes to the capture
 * worklet only, as the practice band's does.
 */

import type { InputEvents, InputSource, OpenedInput, StartError } from '../audio/input';
import type { CaptureReport } from '../audio/report';
import { FLAG_GAP, FRAME_RATE, decodeFrame } from './frame';
import { QspError, qspErrorText, qspStartSession, qspStop, qspTune, streamUrl, type FetchFn } from './qsp';

/** Seconds between a frame's UTC and when it plays: room for the network's jitter. */
export const PLAYOUT_S = 1.5;
/** Drift between the mapping and the clocks that sets it again, ms. */
const DRIFT_MS = 20;

/** Where the session goes and what it reports, read when the input opens. */
export interface WebSdrConfig {
  base(): string;
  key(): string;
  receiver(): string | null;
  receiverName(): string;
  dialHz(): number;
  /** The name the receiver's other listeners see: the operator's callsign. */
  listener(): string;
  status(s: WebSdrStatus): void;
}

export interface WebSdrStatus {
  state: 'connecting' | 'streaming' | 'ended';
  /** For ended: busy, refused, closed, error, stopped, relay. */
  reason?: string;
  /** For ended: what happened, in words. */
  message?: string;
}

export function webSdrReport(contextRate: number, name: string): CaptureReport {
  return {
    inputLabel: name ? `Web SDR · ${name}` : 'Web SDR',
    deviceId: null,
    contextRate,
    trackRate: FRAME_RATE,
    trackChannels: 1,
    arrivingChannels: null,
    channelUsed: null,
    measuredRate: null,
    echoCancellation: null,
    noiseSuppression: null,
    autoGainControl: null,
    audioSession: null,
  };
}

export class WebSdrInput implements InputSource {
  /** Capture's timestamps less the playout delay: each sample keeps the time QSP gave it. */
  readonly offsetS = -PLAYOUT_S;
  private session: { base: string; key: string; id: string } | null = null;

  constructor(
    private readonly cfg: WebSdrConfig,
    private readonly now: () => number = () => Date.now(),
    private readonly socket: (url: string) => WebSocket = (url) => new WebSocket(url),
    private readonly fetchFn?: FetchFn,
  ) {}

  unavailable(): StartError | null {
    return null;
  }

  /** Retunes an open session, as after a change of band. */
  tune(dialHz: number) {
    const s = this.session;
    if (s) void qspTune(s.base, s.key, s.id, dialHz, this.fetchFn).catch(() => undefined);
  }

  async open(ctx: AudioContext, _deviceId: string | null, events: InputEvents): Promise<OpenedInput> {
    const out = ctx.createGain();
    const base = this.cfg.base();
    const key = this.cfg.key();
    const receiver = this.cfg.receiver();
    const playing = new Set<AudioBufferSourceNode>();
    let ws: WebSocket | null = null;
    let closed = false;
    let ended = false;
    /** UTC (ms, with the playout delay) and the audio clock time it maps to. */
    let anchor: { utcMs: number; ctxS: number } | null = null;

    const end = (reason: string, message: string) => {
      if (closed || ended) return;
      ended = true;
      this.cfg.status({ state: 'ended', reason, message });
      events.ended();
    };

    const play = (utcMs: number, samples: Float32Array, gap: boolean) => {
      const t = ctx.currentTime;
      const at = utcMs + PLAYOUT_S * 1000;
      const fresh = t + (at - this.now()) / 1000;
      if (!anchor || gap || Math.abs(anchor.ctxS + (at - anchor.utcMs) / 1000 - fresh) * 1000 > DRIFT_MS) anchor = { utcMs: at, ctxS: fresh };
      const when = anchor.ctxS + (at - anchor.utcMs) / 1000;
      const late = Math.max(0, t - when);
      if (late >= samples.length / FRAME_RATE) return;
      const buffer = ctx.createBuffer(1, samples.length, FRAME_RATE);
      buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(out);
      src.start(Math.max(t, when), late);
      playing.add(src);
      src.onended = () => {
        src.disconnect();
        playing.delete(src);
      };
    };

    const onMessage = (e: MessageEvent) => {
      if (typeof e.data === 'string') {
        let m: { type?: string; state?: string; reason?: string; message?: string } = {};
        try {
          m = JSON.parse(e.data) as typeof m;
        } catch {
          return;
        }
        if (m.type !== 'status') return;
        if (m.state === 'streaming') this.cfg.status({ state: 'streaming' });
        else if (m.state === 'ended') end(m.reason ?? 'closed', m.message ?? 'The receiver closed the connection.');
        return;
      }
      if (!(e.data instanceof ArrayBuffer)) return;
      const f = decodeFrame(e.data);
      if (f) play(f.utcMs, f.samples, (f.flags & FLAG_GAP) !== 0);
    };

    const connect = async () => {
      this.cfg.status({ state: 'connecting' });
      if (!base || !receiver) {
        end('relay', 'Choose a relay and a receiver in Settings › Web SDR.');
        return;
      }
      try {
        const s = await qspStartSession(base, key, receiver, this.cfg.dialHz(), this.cfg.listener(), this.fetchFn);
        if (closed) {
          void qspStop(base, key, s.id, this.fetchFn).catch(() => undefined);
          return;
        }
        if (!s.stream) throw new QspError('format');
        this.session = { base, key, id: s.id };
        ws = this.socket(streamUrl(base, s.stream));
        ws.binaryType = 'arraybuffer';
        ws.onmessage = onMessage;
        ws.onclose = () => end('closed', 'The relay closed the stream.');
        ws.onerror = () => end('relay', 'The relay stream failed.');
      } catch (e) {
        end(e instanceof QspError && e.code === 'receiver-busy' ? 'busy' : 'relay', qspErrorText(e));
      }
    };
    void connect();

    return {
      node: out,
      report: webSdrReport(ctx.sampleRate, this.cfg.receiverName()),
      usable: () => !closed && !ended && ws?.readyState === WebSocket.OPEN,
      close: () => {
        closed = true;
        if (ws) {
          ws.onclose = null;
          ws.onerror = null;
          ws.onmessage = null;
          ws.close();
        }
        for (const p of playing) {
          try {
            p.stop();
          } catch {
            // Not started.
          }
          p.disconnect();
        }
        playing.clear();
        out.disconnect();
        const s = this.session;
        this.session = null;
        if (s) void qspStop(s.base, s.key, s.id, this.fetchFn).catch(() => undefined);
      },
    };
  }
}
