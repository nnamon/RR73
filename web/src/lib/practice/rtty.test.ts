import { describe, expect, it } from 'vitest';
import { RttyStations } from './rtty';

const T = Date.UTC(2026, 9, 14, 14, 0, 0);

/** Runs the stations through `ms` of time in 250 ms ticks; returns what they sent, by station. */
function run(st: RttyStations, from: number, ms: number, onAir = false) {
  const out: { at: number; call: string; text: string }[] = [];
  for (let t = from; t < from + ms; t += 250) for (const x of st.due(t, onAir)) out.push({ at: t, call: x.call, text: x.text.trim() });
  return out;
}

/** The operator transmits `text` from `at` for 5 s. */
function transmit(st: RttyStations, at: number, text: string) {
  st.sent(text);
  run(st, at, 5000, true);
}

describe('RTTY stations on the practice band', () => {
  it('call CQ in turn, each at its own pair, and never while the operator is on air', () => {
    const st = new RttyStations('9V1NE', T);
    const sent = run(st, T, 60_000);
    expect(sent.filter((s) => s.call === 'JA1XYZ').map((s) => s.text)).toEqual(['CQ CQ CQ DE JA1XYZ JA1XYZ JA1XYZ\nPSE K', 'CQ CQ CQ DE JA1XYZ JA1XYZ JA1XYZ\nPSE K']);
    expect(sent.filter((s) => s.call === 'OH2BAX').length).toBeGreaterThanOrEqual(2);
    expect(sent.some((s) => s.call === 'DL5ABC')).toBe(false);
    expect(run(new RttyStations('9V1NE', T), T, 60_000, true)).toEqual([]);
  });

  it('JA1XYZ answers a call with name and QTH, and signs after 73', () => {
    const st = new RttyStations('9V1NE', T);
    transmit(st, T + 10_000, '\nJA1XYZ JA1XYZ DE 9V1NE 9V1NE K\n');
    const reply = run(st, T + 15_000, 3000).filter((s) => s.call === 'JA1XYZ');
    expect(reply).toHaveLength(1);
    expect(reply[0].at).toBe(T + 17_000);
    expect(reply[0].text).toContain('NAME TARO TARO QTH YOKOHAMA YOKOHAMA');
    expect(reply[0].text).toContain('UR RST 579 579');
    transmit(st, T + 40_000, 'TNX TARO 73 ES GL. JA1XYZ DE 9V1NE SK');
    expect(run(st, T + 45_000, 3000).find((s) => s.call === 'JA1XYZ')?.text).toBe('R R TNX FER QSO. 73 ES GL\n9V1NE DE JA1XYZ SK');
    expect(run(st, T + 48_000, 120_000).some((s) => s.call === 'JA1XYZ')).toBe(false);
  });

  it('DL5ABC answers the operator CQ and then works the operator', () => {
    const st = new RttyStations('9V1NE', T);
    transmit(st, T, 'CQ CQ CQ DE 9V1NE 9V1NE 9V1NE PSE K');
    expect(run(st, T + 5000, 3000).find((s) => s.call === 'DL5ABC')?.text).toBe('9V1NE 9V1NE DE DL5ABC DL5ABC K');
    transmit(st, T + 20_000, 'DL5ABC DE 9V1NE TNX FER CALL. UR RST 599 599');
    expect(run(st, T + 25_000, 3000).find((s) => s.call === 'DL5ABC')?.text).toContain('NAME HANS HANS QTH MUNICH MUNICH');
  });

  it('OH2BAX gives a contest exchange and ends with TU', () => {
    const st = new RttyStations('9V1NE', T);
    transmit(st, T + 5000, '9V1NE 9V1NE');
    expect(run(st, T + 10_000, 3000).some((s) => s.call === 'OH2BAX' && s.text.startsWith('9V1NE'))).toBe(false);
    transmit(st, T + 20_000, 'OH2BAX 9V1NE 9V1NE');
    expect(run(st, T + 25_000, 3000).find((s) => s.call === 'OH2BAX')?.text).toBe('9V1NE 599 0877 0877');
    transmit(st, T + 30_000, 'TU 599 042 042');
    expect(run(st, T + 35_000, 3000).find((s) => s.call === 'OH2BAX')?.text).toBe('TU OH2BAX TEST');
  });
});
