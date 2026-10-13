import { describe, expect, it } from 'vitest';
import { PRE_ROLL_MS, TxScheduler, type Encoder, type Playing, type TxAudio, type TxReport } from './scheduler';

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
  /** Moves the clock to UTC `ms`, running due timers and ending sounds that finish. */
  advanceTo(ms: number) {
    this.currentTime = this.toContextTime(ms)!;
    for (const t of [...this.timers].sort((a, b) => a.at - b.at)) {
      if (t.at <= this.currentTime) {
        this.timers.splice(this.timers.indexOf(t), 1);
        t.fn();
      }
    }
    for (const p of this.played) {
      if (p.stoppedAt === null && p.when + p.samples / this.sampleRate <= this.currentTime) {
        p.stoppedAt = p.when + p.samples / this.sampleRate;
        p.handle.onended?.();
      }
    }
  }
}

function setup(gate: () => string | null = () => null, encoderDelay = 0) {
  const clock = new FakeClock();
  const reports: TxReport[] = [];
  const texts: string[] = [];
  const encoder: Encoder = {
    synthesize: async (text, mode, f0, rate) => {
      texts.push(`${text}@${f0}/${rate}/${mode}`);
      if (encoderDelay) clock.advanceTo(clock.toUtcMs(clock.currentTime)! + encoderDelay);
      return new Float32Array(Math.round((mode === 'FT8' ? 12.64 : 5.04) * rate));
    },
  };
  const sched = new TxScheduler({
    audio: () => clock,
    encoder,
    gate,
    report: (r) => reports.push(r),
    timer: (fn, ms) => {
      const t = { at: clock.currentTime + ms / 1000, fn };
      clock.timers.push(t);
      return t;
    },
    clear: (h) => {
      const i = clock.timers.indexOf(h as never);
      if (i >= 0) clock.timers.splice(i, 1);
    },
  });
  return { clock, reports, texts, sched };
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
    expect(reports).toEqual([{ type: 'started', slotStartMs: T0 + 15000, text: 'CQ 9V1NE OJ11', startUtcMs: T0 + 15500, lateS: 0 }]);
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

  it('reports a start later than the limit as missed and plays nothing', async () => {
    const { clock, reports, sched } = setup();
    clock.advanceTo(T0 + 15000 + 2000);
    await sched.schedule(req());
    expect(clock.played).toEqual([]);
    expect(reports).toEqual([{ type: 'missed', slotStartMs: T0 + 15000, text: 'CQ 9V1NE OJ11', reason: 'late' }]);
    const ft4 = setup();
    ft4.clock.advanceTo(T0 + 15000 + 1490);
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
    const unmapped = setup();
    unmapped.clock.mapped = false;
    await unmapped.sched.schedule(req());
    expect(unmapped.reports[0]).toMatchObject({ type: 'refused' });
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
