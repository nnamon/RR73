import { describe, expect, it } from 'vitest';
import { active, barSteps, txButton } from './bar';
import { initialState, type Partner, type SeqConfig, type SeqState } from '../qso/sequencer';

const CONFIG: SeqConfig = {
  myCall: '9V1NE',
  myGrid: 'OJ11',
  mode: 'FT8',
  band: '20m',
  dialHz: 14_074_000,
  txHz: 1500,
  ack: 'RR73',
  maxRetries: 3,
  order: 'first',
  workDupes: false,
  activationId: null,
  run: false,
  tailEnd: true,
  huntOrder: 'unworked',
  watchdogMs: 360_000,
  cqParity: 'even',
  cqModifier: null,
  preset: 'baseline',
  hound: false,
};

const idle = (): SeqState => initialState(CONFIG);
const partner = (extra: Partial<Partner> = {}): Partner => ({
  call: 'VK2LAW',
  grid: 'QF56',
  freqHz: 766,
  snrDb: -12,
  dtS: 0,
  reportSent: null,
  reportRcvd: null,
  sentRpt: false,
  rcvdRpt: false,
  sentRRpt: false,
  rcvdRRpt: false,
  sentAck: false,
  rcvdAck: false,
  startMs: null,
  logged: false,
  foxHz: null,
  ...extra,
});

describe('barSteps', () => {
  it('shows no steps while idle', () => {
    expect(active(idle())).toBe(false);
    expect(barSteps(idle())).toEqual([]);
  });

  it('gives CQ its own steps before anyone answers', () => {
    const st = { ...idle(), phase: 'cq' as const };
    expect(active(st)).toBe(true);
    expect(barSteps(st).map((s) => `${s.label} ${s.state}`)).toEqual(['CQ now', 'Report todo', 'R-report todo', 'RR73 todo', 'Logged todo']);
    expect(barSteps({ ...st, config: { ...CONFIG, ack: 'RRR' } })[3].label).toBe('RRR');
  });

  it('keeps CQ as the first step once a station answers, and fills in the reports', () => {
    const st = { ...idle(), phase: 'cq' as const, partner: partner({ reportSent: -9, sentRpt: true }) };
    expect(barSteps(st).map((s) => `${s.label} ${s.state}`)).toEqual(['CQ done', '−09 done', 'R-report now', 'RR73 todo', 'Logged todo']);
  });

  it('shows the QSO steps while answering a station', () => {
    const st = { ...idle(), phase: 'answering' as const, partner: partner() };
    expect(barSteps(st).map((s) => s.label)).toEqual(['OJ11', 'Report', 'R-report', 'RR73', '73']);
  });
});

describe('txButton', () => {
  it('reads Tx off, Tx on, then On air while transmitting', () => {
    expect(txButton(false, false)).toEqual({ look: 'off', label: 'Tx off' });
    expect(txButton(true, false)).toEqual({ look: 'on', label: 'Tx on' });
    expect(txButton(true, true)).toEqual({ look: 'air', label: 'On air' });
    // Tx off during a transmission lets it finish: still on air.
    expect(txButton(false, true)).toEqual({ look: 'air', label: 'On air' });
  });
});
