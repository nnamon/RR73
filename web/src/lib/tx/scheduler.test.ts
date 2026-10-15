import { describe, expect, it } from 'vitest';
import { PRE_ROLL_MS, TxScheduler, cutStart, type Encoder, type Playing, type TxAudio, type TxReport } from './scheduler';
import { DIAL_TIMEOUT_MS, PTT_SETTLE_MS, PTT_TAIL_MS, PTT_TIMEOUT_MS, type KeyResult, type Keyer, type Keying } from './keyer';

/** Lets promises and the scheduler's async steps run. */
const settle = () => new Promise((r) => setTimeout(r, 0));

const T0 = Date.UTC(2026, 9, 13, 13, 14, 0);

/** A fake audio clock: context time 0 is heard at UTC T0 − 100 s. Timers run when the clock passes them. */
class FakeClock implements TxAudio {
  sampleRate = 48000;
  currentTime = 100;
  played: { when: number; level: number; samples: number; stoppedAt: number | null; handle: Playing }[] = [];
  timers: { at: number; fn: () => void }[] = [];
  mapped = true;
  /** Seconds a sound takes beyond its length, as when the audio thread stalls and its clock falls behind. */
  lagS = 0;

  toContextTime(utcMs: number) {
    return this.mapped ? (utcMs - (T0 - 100_000)) / 1000 : null;
  }
  toUtcMs(t: number) {
    return this.mapped ? t * 1000 + (T0 - 100_000) : null;
  }
  play(samples: Float32Array, when: number, level: number): Playing {
    const entry = { when, level, samples: samples.length, stoppedAt: null as number | null, handle: null as unknown as Playing };
    entry.handle = {
      onended: null,
      stop: () => {
        entry.stoppedAt = this.currentTime;
      },
    };
    this.played.push(entry);
    return entry.handle;
  }
  /** UTC now, ms, whether or not the clock has its mapping. */
  utcNow() {
    return this.currentTime * 1000 + (T0 - 100_000);
  }
  /** Moves the clock to UTC `ms`, running due timers and ending sounds that finish. */
  advanceTo(ms: number) {
    this.currentTime = (ms - (T0 - 100_000)) / 1000;
    for (const t of [...this.timers].sort((a, b) => a.at - b.at)) {
      if (t.at <= this.currentTime) {
        this.timers.splice(this.timers.indexOf(t), 1);
        t.fn();
      }
    }
    for (const p of this.played) {
      if (p.stoppedAt === null && p.when + p.samples / this.sampleRate + this.lagS <= this.currentTime) {
        p.stoppedAt = p.when + p.samples / this.sampleRate + this.lagS;
        p.handle.onended?.();
      }
    }
  }
}

/**
 * A radio's PTT on the fake clock: it answers PTT on `answer` after `delayMs`, or never for
 * `timeout`, as the radio link does after PTT_TIMEOUT_MS. `log` records PTT on and off with the
 * UTC time, and `keyed` says whether PTT is on now.
 */
class FakeKeyer implements Keyer {
  log: string[] = [];
  keyed = false;
  maxMs: number[] = [];
  /** The dial shift of each keying, Hz. */
  shifts: number[] = [];
  last: (Keying & { taken: boolean }) | null = null;
  constructor(
    private readonly clock: FakeClock,
    public answer: KeyResult = 'ok',
    public delayMs = 20,
  ) {}
  private utc() {
    return this.clock.toUtcMs(this.clock.currentTime)! - T0;
  }
  key(maxMs: number, shiftHz = 0): Keying {
    this.keyed = true;
    this.maxMs.push(maxMs);
    this.shifts.push(shiftHz);
    this.log.push(`on@${this.utc()}`);
    let released = false;
    const result = new Promise<KeyResult>((resolve) => {
      const wait = this.answer === 'timeout' ? PTT_TIMEOUT_MS : this.delayMs;
      this.clock.timers.push({ at: this.clock.currentTime + wait / 1000, fn: () => resolve(this.answer) });
    });
    const keying = {
      result,
      release: (tailMs = 0) => {
        if (released) return;
        released = true;
        this.log.push(`off@${this.utc()}+${tailMs}`);
        this.keyed = false;
      },
      get held() {
        return !released && !keying.taken;
      },
      /** PTT taken back from outside, as Halt's PTT off does. */
      taken: false,
    };
    this.last = keying;
    return keying;
  }
}

function setup(gate: () => string | null = () => null, encoderDelay = 0, keyed?: { answer?: KeyResult; delayMs?: number }, shift?: (mode: string, f0Hz: number) => number) {
  const clock = new FakeClock();
  const keyer = keyed ? new FakeKeyer(clock, keyed.answer, keyed.delayMs) : null;
  const reports: TxReport[] = [];
  const texts: string[] = [];
  const encoder: Encoder = {
    synthesize: async (text, mode, f0, rate) => {
      texts.push(`${text}@${f0}/${rate}/${mode}`);
      if (encoderDelay) clock.advanceTo(clock.toUtcMs(clock.currentTime)! + encoderDelay);
      return new Float32Array(Math.round((mode === 'FT8' ? 12.64 : mode === 'WSPR' ? 110.592 : 5.04) * rate));
    },
  };
  const sched = new TxScheduler({
    audio: () => clock,
    encoder,
    gate,
    report: (r) => reports.push(r),
    keyer: () => keyer,
    shift,
    timer: (fn, ms) => {
      const t = { at: clock.currentTime + ms / 1000, fn };
      clock.timers.push(t);
      return t;
    },
    clear: (h) => {
      const i = clock.timers.indexOf(h as never);
      if (i >= 0) clock.timers.splice(i, 1);
    },
    now: () => clock.utcNow(),
  });
  return { clock, reports, texts, sched, keyer: keyer! };
}

const req = (over: Partial<Parameters<TxScheduler['schedule']>[0]> = {}) => ({
  text: 'CQ 9V1NE OJ11',
  mode: 'FT8' as const,
  slotStartMs: T0 + 15000,
  startOffsetS: 0.5,
  f0Hz: 1500,
  level: 0.5,
  ...over,
});

describe('TxScheduler', () => {
  it('synthesises at once, hands the sound over 0.5 s ahead, and starts at slot + 0.5 s', async () => {
    const { clock, reports, texts, sched } = setup();
    clock.advanceTo(T0 + 3000);
    const done = sched.schedule(req());
    await settle();
    expect(texts).toEqual(['CQ 9V1NE OJ11@1500/48000/FT8']);
    expect(clock.played).toEqual([]);
    expect(sched.busy).toBe(true);
    clock.advanceTo(T0 + 15500 - PRE_ROLL_MS - 1);
    await settle();
    expect(clock.played).toEqual([]);
    clock.advanceTo(T0 + 15500 - PRE_ROLL_MS);
    await done;
    expect(clock.played).toHaveLength(1);
    expect(clock.played[0].when).toBeCloseTo(clock.toContextTime(T0 + 15500)!, 9);
    expect(clock.played[0].level).toBe(0.5);
    expect(reports).toEqual([]);
    clock.advanceTo(T0 + 15500);
    expect(reports).toEqual([{ type: 'started', slotStartMs: T0 + 15000, text: 'CQ 9V1NE OJ11', startUtcMs: T0 + 15500, lateS: 0, skippedS: 0 }]);
    clock.advanceTo(T0 + 15000 + 13200);
    expect(reports.at(-1)).toEqual({ type: 'ended', slotStartMs: T0 + 15000, text: 'CQ 9V1NE OJ11', complete: true });
    expect(sched.busy).toBe(false);
  });

  it('starts late, up to 1.5 s in FT8, when the decision came late', async () => {
    const { clock, reports, sched } = setup();
    clock.advanceTo(T0 + 15000 + 1700);
    await sched.schedule(req());
    const late = clock.played[0].when - clock.toContextTime(T0 + 15500)!;
    expect(late).toBeCloseTo(1.22, 2);
    clock.advanceTo(T0 + 17300);
    expect(reports[0]).toMatchObject({ type: 'started' });
    expect((reports[0] as { lateS: number }).lateS).toBeCloseTo(1.22, 2);
  });

  it('later than the shift limit, keeps its place in the slot and leaves out its first part', async () => {
    for (const [mode, inS, dur] of [
      ['FT8', 3.0, 12.64],
      ['FT4', 1.2, 5.04],
    ] as const) {
      const { clock, reports, sched } = setup();
      clock.advanceTo(T0 + 15000 + inS * 1000);
      await sched.schedule(req({ mode }));
      const lateS = inS + 0.02 - 0.5;
      // It starts now and ends where the whole message would: 0.5 s + its length into the slot.
      expect(clock.played[0].samples / clock.sampleRate, mode).toBeCloseTo(dur - lateS, 3);
      expect(clock.played[0].when + clock.played[0].samples / clock.sampleRate, mode).toBeCloseTo(clock.toContextTime(T0 + 15500 + dur * 1000)!, 3);
      clock.advanceTo(T0 + 15000 + (inS + 0.1) * 1000);
      expect(reports[0], mode).toMatchObject({ type: 'started' });
      expect((reports[0] as { skippedS: number }).skippedS, mode).toBeCloseTo(lateS, 3);
    }
  });

  it('fades in where it starts part way through', () => {
    const out = cutStart(new Float32Array(1000).fill(1), 400, 240);
    expect(out).toHaveLength(600);
    expect(out[0]).toBe(0);
    expect(out[120]).toBeCloseTo(0.5, 2);
    expect(out[239]).toBeGreaterThan(0.99);
    expect(out[240]).toBe(1);
  });

  it('reports a start later than the limit as missed and plays nothing', async () => {
    const { clock, reports, sched } = setup();
    clock.advanceTo(T0 + 15000 + 4500);
    await sched.schedule(req());
    expect(clock.played).toEqual([]);
    expect(reports).toEqual([{ type: 'missed', slotStartMs: T0 + 15000, text: 'CQ 9V1NE OJ11', reason: 'late' }]);
    const ft4 = setup();
    ft4.clock.advanceTo(T0 + 15000 + 1740);
    await ft4.sched.schedule(req({ mode: 'FT4' }));
    expect(ft4.reports).toEqual([{ type: 'missed', slotStartMs: T0 + 15000, text: 'CQ 9V1NE OJ11', reason: 'late' }]);
  });

  it('uses the clock mapping of the moment it hands the sound over', async () => {
    const { clock, sched } = setup();
    clock.advanceTo(T0 + 3000);
    const done = sched.schedule(req());
    await settle();
    // The audio clock has drifted 120 ms against UTC by the time of the pre-roll.
    const drifted = clock.toContextTime.bind(clock);
    clock.toContextTime = (ms: number) => drifted(ms)! - 0.12;
    clock.advanceTo(T0 + 15200);
    await done;
    expect(clock.played[0].when).toBeCloseTo(drifted(T0 + 15500)! - 0.12, 9);
  });

  it('cancel during the wait drops the transmission', async () => {
    const { clock, reports, sched } = setup();
    clock.advanceTo(T0 + 3000);
    const done = sched.schedule(req());
    await settle();
    sched.cancel();
    await done;
    clock.advanceTo(T0 + 20000);
    expect(clock.played).toEqual([]);
    expect(reports).toEqual([]);
    expect(sched.busy).toBe(false);
  });

  it('counts the time synthesis took', async () => {
    const { clock, sched } = setup(() => null, 300);
    clock.advanceTo(T0 + 15000 + 100);
    await sched.schedule(req());
    expect(clock.played[0].when).toBeCloseTo(clock.toContextTime(T0 + 15500)!, 9);
    const slow = setup(() => null, 900);
    slow.clock.advanceTo(T0 + 15000 + 100);
    await slow.sched.schedule(req());
    expect(slow.clock.played[0].when).toBeCloseTo(slow.clock.toContextTime(T0 + 15000 + 1000 + 20)!, 6);
  });

  it('refuses while the gate is closed or the clock has no mapping', async () => {
    const closed = setup(() => 'Confirm the band in the band sheet to transmit.');
    await closed.sched.schedule(req());
    expect(closed.reports).toEqual([{ type: 'refused', slotStartMs: T0 + 15000, text: 'CQ 9V1NE OJ11', reason: 'Confirm the band in the band sheet to transmit.' }]);
    expect(closed.clock.played).toEqual([]);
    // The mapping still missing at the pre-roll.
    const unmapped = setup();
    unmapped.clock.mapped = false;
    unmapped.clock.advanceTo(T0 + 3000);
    const done = unmapped.sched.schedule(req());
    await settle();
    unmapped.clock.advanceTo(T0 + 15000);
    await done;
    expect(unmapped.reports).toEqual([{ type: 'refused', slotStartMs: T0 + 15000, text: 'CQ 9V1NE OJ11', reason: 'Audio is not running.' }]);
    expect(unmapped.clock.played).toEqual([]);
  });

  it('times the wait by the page clock when audio has only just started and its clock has no mapping yet', async () => {
    const { clock, reports, sched } = setup();
    clock.mapped = false;
    clock.advanceTo(T0 + 3000);
    const done = sched.schedule(req());
    await settle();
    expect(reports).toEqual([]);
    // The mapping arrives a moment later; the transmission goes on time.
    clock.mapped = true;
    clock.advanceTo(T0 + 15000);
    await done;
    expect(clock.played).toHaveLength(1);
    expect(clock.played[0].when).toBeCloseTo(clock.toContextTime(T0 + 15500)!, 9);
    expect(reports).toEqual([]);
  });

  it('Halt stops a transmission on air at once and reports it incomplete', async () => {
    const { clock, reports, sched } = setup();
    clock.advanceTo(T0 + 15100);
    await sched.schedule(req());
    clock.advanceTo(T0 + 18000);
    sched.halt();
    expect(clock.played[0].stoppedAt).toBeCloseTo(clock.toContextTime(T0 + 18000)!, 9);
    expect(reports.at(-1)).toEqual({ type: 'ended', slotStartMs: T0 + 15000, text: 'CQ 9V1NE OJ11', complete: false });
    clock.advanceTo(T0 + 30000);
    expect(reports.filter((r) => r.type === 'ended')).toHaveLength(1);
  });

  it('Halt before the start stops the scheduled sound and reports it missed', async () => {
    const { clock, reports, sched } = setup();
    clock.advanceTo(T0 + 15100);
    await sched.schedule(req());
    sched.halt();
    expect(clock.played[0].stoppedAt).not.toBeNull();
    clock.advanceTo(T0 + 16000);
    expect(reports).toEqual([{ type: 'missed', slotStartMs: T0 + 15000, text: 'CQ 9V1NE OJ11', reason: 'late' }]);
  });

  it('cancel withdraws a transmission that has not started and leaves one on air alone', async () => {
    const { clock, reports, sched } = setup();
    clock.advanceTo(T0 + 15100);
    await sched.schedule(req());
    sched.cancel();
    expect(clock.played[0].stoppedAt).not.toBeNull();
    clock.advanceTo(T0 + 16000);
    expect(reports).toEqual([]);
    clock.advanceTo(T0 + 45100);
    await sched.schedule(req({ slotStartMs: T0 + 45000 }));
    clock.advanceTo(T0 + 46000);
    sched.cancel();
    expect(clock.played[1].stoppedAt).toBeNull();
    clock.advanceTo(T0 + 60000);
    expect(reports.at(-1)).toEqual({ type: 'ended', slotStartMs: T0 + 45000, text: 'CQ 9V1NE OJ11', complete: true });
  });

  it('drops a synthesis that finishes after a cancel', async () => {
    const { clock, sched } = setup(() => null, 200);
    clock.advanceTo(T0 + 15100);
    const pending = sched.schedule(req());
    sched.cancel();
    await pending;
    expect(clock.played).toEqual([]);
  });

  it('never cuts a transmission the audio clock has started, and turns away another for the same slot', async () => {
    const { clock, reports, sched } = setup();
    clock.advanceTo(T0 + 15100);
    await sched.schedule(req());
    // The audio clock passes the start before the started timer has run.
    clock.currentTime = clock.toContextTime(T0 + 15600)!;
    await sched.schedule(req({ text: 'JA1KXM 9V1NE R-10' }));
    expect(clock.played).toHaveLength(1);
    expect(clock.played[0].stoppedAt).toBeNull();
    expect(reports).toEqual([{ type: 'missed', slotStartMs: T0 + 15000, text: 'JA1KXM 9V1NE R-10', reason: 'busy' }]);
    sched.cancel();
    expect(clock.played[0].stoppedAt).toBeNull();
    // Halt still stops it, and reports it started and cut.
    sched.halt();
    expect(clock.played[0].stoppedAt).not.toBeNull();
    expect(reports.slice(1).map((r) => r.type)).toEqual(['started', 'ended']);
    expect(reports.at(-1)).toMatchObject({ complete: false, text: 'CQ 9V1NE OJ11' });
  });

  it('replaces a transmission that has not started yet', async () => {
    const { clock, reports, sched } = setup();
    clock.advanceTo(T0 + 15100);
    await sched.schedule(req());
    await sched.schedule(req({ text: 'JA1KXM 9V1NE R-10' }));
    expect(clock.played).toHaveLength(2);
    expect(clock.played[0].stoppedAt).not.toBeNull();
    expect(clock.played[1].stoppedAt).toBeNull();
    clock.advanceTo(T0 + 15600);
    expect(reports).toMatchObject([{ type: 'started', text: 'JA1KXM 9V1NE R-10' }]);
  });

  it('reports a message that cannot be synthesised as missed', async () => {
    const reports: TxReport[] = [];
    const clock = new FakeClock();
    const sched = new TxScheduler({ audio: () => clock, encoder: { synthesize: async () => Promise.reject(new Error('bad')) }, gate: () => null, report: (r) => reports.push(r) });
    await sched.schedule(req());
    expect(reports).toEqual([{ type: 'missed', slotStartMs: T0 + 15000, text: 'CQ 9V1NE OJ11', reason: 'encode' }]);
  });
});

describe('TxScheduler in WSPR', () => {
  const wspr = (over = {}) => req({ text: '9V1NE OJ11 37', mode: 'WSPR', slotStartMs: T0 + 120_000, startOffsetS: 1, ...over });

  it('starts 1 s into the slot and plays the whole 110.6 s', async () => {
    const { clock, reports, sched } = setup();
    clock.advanceTo(T0 + 120_600);
    await sched.schedule(wspr());
    expect(clock.played[0].when).toBeCloseTo(clock.toContextTime(T0 + 121_000)!, 9);
    clock.advanceTo(T0 + 121_000);
    expect(reports[0]).toEqual({ type: 'started', slotStartMs: T0 + 120_000, text: '9V1NE OJ11 37', startUtcMs: T0 + 121_000, lateS: 0, skippedS: 0 });
    clock.advanceTo(T0 + 121_000 + 110_592);
    expect(reports.at(-1)).toEqual({ type: 'ended', slotStartMs: T0 + 120_000, text: '9V1NE OJ11 37', complete: true });
  });

  it('starts up to 1 s late, and misses the slot after that', async () => {
    const late = setup();
    late.clock.advanceTo(T0 + 121_900);
    await late.sched.schedule(wspr());
    expect(late.clock.played).toHaveLength(1);
    late.clock.advanceTo(T0 + 122_000);
    expect((late.reports[0] as { lateS: number }).lateS).toBeCloseTo(0.92, 2);
    const missed = setup();
    missed.clock.advanceTo(T0 + 122_100);
    await missed.sched.schedule(wspr());
    expect(missed.clock.played).toEqual([]);
    expect(missed.reports).toEqual([{ type: 'missed', slotStartMs: T0 + 120_000, text: '9V1NE OJ11 37', reason: 'late' }]);
  });
});


describe('TxScheduler keying the radio', () => {
  /** Runs the fake clock forward in steps so awaited answers and the timers after them run. */
  async function runTo(clock: FakeClock, ms: number) {
    const end = clock.toContextTime(ms)!;
    for (;;) {
      await settle();
      const ends = clock.played.filter((p) => p.stoppedAt === null).map((p) => p.when + p.samples / clock.sampleRate + clock.lagS);
      const next = Math.min(end, ...clock.timers.map((t) => t.at), ...ends);
      clock.advanceTo(clock.toUtcMs(Math.max(next, clock.currentTime))!);
      await settle();
      if (next >= end) return;
    }
  }

  it('keys 0.5 s ahead, starts the audio on time at slot + 0.5 s, and releases PTT 0.1 s after the end', async () => {
    const { clock, reports, sched, keyer } = setup(() => null, 0, { delayMs: 20 });
    clock.advanceTo(T0 + 3000);
    const done = sched.schedule(req());
    await runTo(clock, T0 + 15000 - 10);
    expect(keyer.log).toEqual([]);
    expect(clock.played).toEqual([]);
    await runTo(clock, T0 + 15100);
    await done;
    expect(keyer.log).toEqual([`on@${15000}`]);
    expect(clock.played).toHaveLength(1);
    expect(clock.played[0].when).toBeCloseTo(clock.toContextTime(T0 + 15500)!, 9);
    // PTT stays off by itself after the slot at the latest.
    expect(keyer.maxMs[0]).toBeGreaterThan(500 + 12_640);
    expect(keyer.maxMs[0]).toBeLessThan(15_000);
    await runTo(clock, T0 + 15000 + 13200);
    expect(reports.map((r) => r.type)).toEqual(['started', 'ended']);
    expect(keyer.log).toEqual([`on@${15000}`, `off@${15000 + 500 + 12_640}+${PTT_TAIL_MS}`]);
  });

  it('stops the audio with PTT when the keying reaches its limit before the audio ends', async () => {
    const { clock, reports, sched, keyer } = setup(() => null, 0, { delayMs: 20 });
    // The sound takes 3 s longer than its length: past the limit, which leaves 1 s to spare.
    clock.lagS = 3;
    clock.advanceTo(T0 + 3000);
    const done = sched.schedule(req());
    await runTo(clock, T0 + 15100);
    await done;
    const limitAt = 15000 + keyer.maxMs[0];
    await runTo(clock, T0 + limitAt + 10);
    expect(keyer.log).toEqual([`on@${15000}`, `off@${limitAt}+0`]);
    expect(clock.played[0].stoppedAt).toBeCloseTo(clock.toContextTime(T0 + limitAt)!, 6);
    expect(reports.map((r) => r.type)).toEqual(['started', 'ended']);
    expect(reports.at(-1)).toMatchObject({ type: 'ended', complete: false });
    expect(sched.busy).toBe(false);
  });

  it('releases PTT after the output latency and the tail', async () => {
    const { clock, sched, keyer } = setup(() => null, 0, { delayMs: 20 });
    (clock as unknown as { outputLatency: number }).outputLatency = 0.06;
    clock.advanceTo(T0 + 3000);
    const done = sched.schedule(req());
    await runTo(clock, T0 + 15000 + 13200);
    await done;
    expect(keyer.log.at(-1)).toBe(`off@${15000 + 500 + 12_640}+${60 + PTT_TAIL_MS}`);
  });

  it('still starts on time when the OK takes the whole timeout', async () => {
    const { clock, sched, keyer } = setup(() => null, 0, { delayMs: PTT_TIMEOUT_MS - 10 });
    clock.advanceTo(T0 + 3000);
    const done = sched.schedule(req());
    await runTo(clock, T0 + 15400);
    await done;
    expect(keyer.log).toEqual([`on@${15000}`]);
    expect(clock.played[0].when).toBeCloseTo(clock.toContextTime(T0 + 15500)!, 9);
    // The audio starts at least PTT_SETTLE_MS after the OK.
    expect((clock.played[0].when - clock.toContextTime(T0 + 15000 + PTT_TIMEOUT_MS - 10)!) * 1000).toBeGreaterThanOrEqual(PTT_SETTLE_MS);
  });

  it('plays nothing and says so when the radio does not answer PTT, and releases it', async () => {
    for (const [answer, text] of [
      ['timeout', 'Radio did not answer PTT'],
      ['ng', 'Radio refused PTT'],
      ['closed', 'Radio not connected'],
    ] as const) {
      const { clock, reports, sched, keyer } = setup(() => null, 0, { answer });
      clock.advanceTo(T0 + 3000);
      const done = sched.schedule(req());
      await runTo(clock, T0 + 15500);
      await done;
      expect(clock.played, answer).toEqual([]);
      expect(reports, answer).toEqual([{ type: 'refused', slotStartMs: T0 + 15000, text: 'CQ 9V1NE OJ11', reason: text }]);
      expect(keyer.keyed, answer).toBe(false);
      expect(keyer.log.at(-1), answer).toMatch(/^off@\d+\+0$/);
    }
  });

  it('a late start keys at once and starts the audio 0.1 s after the OK', async () => {
    const { clock, sched, keyer } = setup(() => null, 0, { delayMs: 30 });
    clock.advanceTo(T0 + 15000 + 1000);
    const done = sched.schedule(req());
    await runTo(clock, T0 + 15000 + 1100);
    await done;
    expect(keyer.log).toEqual([`on@${16000}`]);
    expect(clock.played[0].when).toBeCloseTo(clock.toContextTime(T0 + 16030)! + PTT_SETTLE_MS / 1000, 2);
  });

  it('Halt while waiting for the OK releases PTT at once and plays nothing', async () => {
    const { clock, reports, sched, keyer } = setup(() => null, 0, { delayMs: 200 });
    clock.advanceTo(T0 + 3000);
    const done = sched.schedule(req());
    await runTo(clock, T0 + 15050);
    expect(keyer.keyed).toBe(true);
    expect(sched.busy).toBe(true);
    sched.halt();
    expect(keyer.keyed).toBe(false);
    expect(keyer.log).toEqual([`on@${15000}`, `off@${15050}+0`]);
    await runTo(clock, T0 + 16000);
    await done;
    expect(clock.played).toEqual([]);
    expect(reports).toEqual([]);
    expect(sched.busy).toBe(false);
  });

  it('Halt on air stops the audio and releases PTT at once', async () => {
    const { clock, reports, sched, keyer } = setup(() => null, 0, { delayMs: 20 });
    clock.advanceTo(T0 + 3000);
    const done = sched.schedule(req());
    await runTo(clock, T0 + 18000);
    await done;
    sched.halt();
    expect(keyer.log).toEqual([`on@${15000}`, `off@${18000}+0`]);
    expect(reports.at(-1)).toEqual({ type: 'ended', slotStartMs: T0 + 15000, text: 'CQ 9V1NE OJ11', complete: false });
  });

  it('cancel and a replacement before the start release PTT', async () => {
    const { clock, sched, keyer } = setup(() => null, 0, { delayMs: 20 });
    clock.advanceTo(T0 + 3000);
    const done = sched.schedule(req());
    await runTo(clock, T0 + 15100);
    await done;
    sched.cancel();
    expect(keyer.keyed).toBe(false);
    expect(clock.played[0].stoppedAt).not.toBeNull();
    const again = sched.schedule(req({ slotStartMs: T0 + 45000 }));
    await runTo(clock, T0 + 45100);
    await again;
    expect(keyer.keyed).toBe(true);
    // A replacement for the same slot stops the first before it starts, and keys again for itself.
    const replaced = sched.schedule(req({ slotStartMs: T0 + 45000, text: 'JA1KXM 9V1NE R-10' }));
    await runTo(clock, T0 + 45200);
    await replaced;
    expect(keyer.log).toEqual([`on@${15000}`, `off@${15100}+0`, `on@${45000}`, `off@${45100}+0`, `on@${45100}`]);
    expect(keyer.keyed).toBe(true);
    expect(clock.played.at(-1)!.when).toBeCloseTo(clock.toContextTime(T0 + 45500)!, 9);
  });

  it('plays nothing when PTT was taken back before the OK arrived', async () => {
    const { clock, reports, sched, keyer } = setup(() => null, 0, { delayMs: 100 });
    clock.advanceTo(T0 + 3000);
    const done = sched.schedule(req());
    await runTo(clock, T0 + 15050);
    keyer.last!.taken = true;
    await runTo(clock, T0 + 16000);
    await done;
    expect(clock.played).toEqual([]);
    expect(reports).toEqual([{ type: 'missed', slotStartMs: T0 + 15000, text: 'CQ 9V1NE OJ11', reason: 'busy' }]);
    expect(sched.busy).toBe(false);
  });

  it('keys nothing without a keyer', async () => {
    const { clock, sched } = setup();
    clock.advanceTo(T0 + 15100);
    await sched.schedule(req());
    expect(clock.played).toHaveLength(1);
  });

  it('keys WSPR 0.5 s before its audio at slot + 1 s', async () => {
    const { clock, sched, keyer } = setup(() => null, 0, { delayMs: 20 });
    clock.advanceTo(T0 + 110_000);
    const done = sched.schedule(req({ text: '9V1NE OJ11 37', mode: 'WSPR', slotStartMs: T0 + 120_000, startOffsetS: 1 }));
    await runTo(clock, T0 + 120_600);
    await done;
    expect(keyer.log).toEqual([`on@${120_500}`]);
    expect(clock.played[0].when).toBeCloseTo(clock.toContextTime(T0 + 121_000)!, 9);
  });
});

describe('TxScheduler with a dial shift', () => {
  async function runTo(clock: FakeClock, ms: number) {
    const end = clock.toContextTime(ms)!;
    for (;;) {
      await settle();
      const ends = clock.played.filter((p) => p.stoppedAt === null).map((p) => p.when + p.samples / clock.sampleRate);
      const next = Math.min(end, ...clock.timers.map((t) => t.at), ...ends);
      clock.advanceTo(clock.toUtcMs(Math.max(next, clock.currentTime))!);
      await settle();
      if (next >= end) return;
    }
  }

  /** The app's rule for a 1500 to 2000 Hz window in 500 Hz steps, switchable. */
  const window = { on: true };
  const shift = (_mode: string, f0: number) => (!window.on || (f0 >= 1500 && f0 < 2000) ? 0 : Math.floor((f0 - 1500) / 500) * 500);

  it('synthesises at the Tx frequency less the shift, keys with the shift at the pre-roll, and starts on time', async () => {
    window.on = true;
    const { clock, texts, sched, keyer } = setup(() => null, 0, { delayMs: 20 }, shift);
    clock.advanceTo(T0 + 3000);
    const done = sched.schedule(req({ f0Hz: 2800 }));
    await runTo(clock, T0 + 15100);
    await done;
    expect(texts).toEqual(['CQ 9V1NE OJ11@1800/48000/FT8']);
    expect(keyer.shifts).toEqual([1000]);
    expect(keyer.log).toEqual([`on@${15000}`]);
    expect(clock.played[0].when).toBeCloseTo(clock.toContextTime(T0 + 15500)!, 9);
    // The keying's limit leaves room for the dial's answer too.
    expect(keyer.maxMs[0]).toBeGreaterThanOrEqual(500 + DIAL_TIMEOUT_MS + PTT_TIMEOUT_MS + PTT_SETTLE_MS + 12_640);
  });

  it('keys with no shift inside the window or with the switch off', async () => {
    for (const [on, f0] of [
      [true, 1700],
      [false, 2800],
    ] as const) {
      window.on = on;
      const { clock, texts, sched, keyer } = setup(() => null, 0, { delayMs: 20 }, shift);
      clock.advanceTo(T0 + 3000);
      const done = sched.schedule(req({ f0Hz: f0 }));
      await runTo(clock, T0 + 15100);
      await done;
      expect(texts).toEqual([`CQ 9V1NE OJ11@${f0}/48000/FT8`]);
      expect(keyer.shifts).toEqual([0]);
    }
  });

  it('lets the slot go by when the shift changed between the synthesis and the pre-roll', async () => {
    window.on = true;
    const { clock, reports, sched, keyer } = setup(() => null, 0, { delayMs: 20 }, shift);
    clock.advanceTo(T0 + 3000);
    const done = sched.schedule(req({ f0Hz: 2800 }));
    await runTo(clock, T0 + 10_000);
    window.on = false;
    await runTo(clock, T0 + 16_000);
    await done;
    expect(clock.played).toEqual([]);
    expect(keyer.log).toEqual([]);
    expect(reports).toEqual([{ type: 'missed', slotStartMs: T0 + 15000, text: 'CQ 9V1NE OJ11', reason: 'busy' }]);
  });

  it('plays nothing when the radio does not set the Tx dial, and says so', async () => {
    window.on = true;
    const { clock, reports, sched, keyer } = setup(() => null, 0, { answer: 'dial' }, shift);
    clock.advanceTo(T0 + 3000);
    const done = sched.schedule(req({ f0Hz: 2800 }));
    await runTo(clock, T0 + 16_000);
    await done;
    expect(clock.played).toEqual([]);
    expect(reports).toEqual([{ type: 'refused', slotStartMs: T0 + 15000, text: 'CQ 9V1NE OJ11', reason: 'Radio did not set Tx dial' }]);
    expect(keyer.keyed).toBe(false);
  });

  it('a shift without a keyer lets the slot go by: the audio was made for a moved dial', async () => {
    const { clock, reports, sched } = setup(() => null, 0, undefined, () => 1000);
    clock.advanceTo(T0 + 3000);
    const done = sched.schedule(req({ f0Hz: 2800 }));
    await runTo(clock, T0 + 16_000);
    await done;
    expect(clock.played).toEqual([]);
    expect(reports).toMatchObject([{ type: 'missed', reason: 'busy' }]);
  });
});
