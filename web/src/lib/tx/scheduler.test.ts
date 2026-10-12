import { describe, expect, it } from 'vitest';
import { TxScheduler, type Encoder, type Playing, type TxAudio, type TxReport } from './scheduler';

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
  it('synthesises at the output rate and starts at slot + 0.5 s on the audio clock', async () => {
    const { clock, reports, texts, sched } = setup();
    clock.advanceTo(T0 + 14000);
    await sched.schedule(req());
    expect(texts).toEqual(['CQ 9V1NE OJ11@1500/48000/FT8']);
    expect(clock.played).toHaveLength(1);
    expect(clock.played[0].when).toBeCloseTo(clock.toContextTime(T0 + 15500)!, 9);
    expect(clock.played[0].level).toBe(0.5);
    expect(reports).toEqual([]);
    clock.advanceTo(T0 + 15500);
    expect(reports).toEqual([{ type: 'started', slotStartMs: T0 + 15000, startUtcMs: T0 + 15500, lateS: 0 }]);
    clock.advanceTo(T0 + 15000 + 13200);
    expect(reports.at(-1)).toEqual({ type: 'ended', slotStartMs: T0 + 15000, complete: true });
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
    expect(reports).toEqual([{ type: 'missed', slotStartMs: T0 + 15000, reason: 'late' }]);
    const ft4 = setup();
    ft4.clock.advanceTo(T0 + 15000 + 1490);
    await ft4.sched.schedule(req({ mode: 'FT4' }));
    expect(ft4.reports).toEqual([{ type: 'missed', slotStartMs: T0 + 15000, reason: 'late' }]);
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
    expect(closed.reports).toEqual([{ type: 'refused', slotStartMs: T0 + 15000, reason: 'Confirm the band in the band sheet to transmit.' }]);
    expect(closed.clock.played).toEqual([]);
    const unmapped = setup();
    unmapped.clock.mapped = false;
    await unmapped.sched.schedule(req());
    expect(unmapped.reports[0]).toMatchObject({ type: 'refused' });
  });

  it('Halt stops a transmission on air at once and reports it incomplete', async () => {
    const { clock, reports, sched } = setup();
    clock.advanceTo(T0 + 14000);
    await sched.schedule(req());
    clock.advanceTo(T0 + 18000);
    sched.halt();
    expect(clock.played[0].stoppedAt).toBeCloseTo(clock.toContextTime(T0 + 18000)!, 9);
    expect(reports.at(-1)).toEqual({ type: 'ended', slotStartMs: T0 + 15000, complete: false });
    clock.advanceTo(T0 + 30000);
    expect(reports.filter((r) => r.type === 'ended')).toHaveLength(1);
  });

  it('Halt before the start stops the scheduled sound and reports it missed', async () => {
    const { clock, reports, sched } = setup();
    clock.advanceTo(T0 + 14000);
    await sched.schedule(req());
    sched.halt();
    expect(clock.played[0].stoppedAt).not.toBeNull();
    clock.advanceTo(T0 + 16000);
    expect(reports).toEqual([{ type: 'missed', slotStartMs: T0 + 15000, reason: 'late' }]);
  });

  it('cancel withdraws a transmission that has not started and leaves one on air alone', async () => {
    const { clock, reports, sched } = setup();
    clock.advanceTo(T0 + 14000);
    await sched.schedule(req());
    sched.cancel();
    expect(clock.played[0].stoppedAt).not.toBeNull();
    clock.advanceTo(T0 + 16000);
    expect(reports).toEqual([]);
    await sched.schedule(req({ slotStartMs: T0 + 45000 }));
    clock.advanceTo(T0 + 46000);
    sched.cancel();
    expect(clock.played[1].stoppedAt).toBeNull();
    clock.advanceTo(T0 + 60000);
    expect(reports.at(-1)).toEqual({ type: 'ended', slotStartMs: T0 + 45000, complete: true });
  });

  it('drops a synthesis that finishes after a cancel', async () => {
    const { clock, sched } = setup(() => null, 200);
    clock.advanceTo(T0 + 14000);
    const pending = sched.schedule(req());
    sched.cancel();
    await pending;
    expect(clock.played).toEqual([]);
  });

  it('reports a message that cannot be synthesised as missed', async () => {
    const reports: TxReport[] = [];
    const clock = new FakeClock();
    const sched = new TxScheduler({ audio: () => clock, encoder: { synthesize: async () => Promise.reject(new Error('bad')) }, gate: () => null, report: (r) => reports.push(r) });
    await sched.schedule(req());
    expect(reports).toEqual([{ type: 'missed', slotStartMs: T0 + 15000, reason: 'encode' }]);
  });
});
