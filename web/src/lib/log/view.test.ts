import { describe, expect, it } from 'vitest';
import { emptyEntry, type DestinationFacts } from './ledger';
import { createQso } from './qso';
import type { Activation, LedgerEntry, Qso } from './types';
import {
  activationDirect,
  activationFiles,
  afterLine,
  byQso,
  dayLabel,
  directText,
  fileText,
  freqText,
  groupByDay,
  matches,
  qsoLine,
  reportText,
  reportsText,
  rowProblem,
  rowTags,
  shortDate,
  tagFor,
  todoQsos,
} from './view';

const NOW = Date.UTC(2026, 9, 13, 21, 40, 0);
const FACTS: DestinationFacts[] = [
  { id: 'wavelog', name: 'Wavelog', transport: 'direct', active: true, canUpdate: false },
  { id: 'pota-file', name: 'POTA', transport: 'file', active: true, canUpdate: false },
  { id: 'sota-file', name: 'SOTA', transport: 'file', active: true, canUpdate: false },
  { id: 'adif-file', name: 'ADIF', transport: 'file', active: false, canUpdate: false },
];
const ACT: Activation = {
  id: 'a',
  refs: [
    { programme: 'POTA', ref: 'VK-0921' },
    { programme: 'SOTA', ref: 'VK3/VC-012' },
  ],
  callsign: 'VK3/9V1NE',
  operator: '9V1NE',
  grid: 'QF22',
  gridSource: 'gps',
  wavelogStationId: null,
  startedAt: Date.UTC(2026, 9, 11, 18, 0),
  endedAt: Date.UTC(2026, 9, 11, 19, 0),
  updatedAt: 0,
};

let n = 0;
function q(call: string, at: number, extra: Partial<Qso> = {}, a: Activation | null = null): Qso {
  return {
    ...createQso({ call, grid: 'QF56', mode: 'FT8', band: '20m', dialHz: 14_074_000, audioHz: 1500, startUtcMs: at, endUtcMs: at, reportSent: -12, reportRcvd: -10 }, { id: `q${++n}`, now: at, activation: a, callsign: '9V1NE' }),
    ...extra,
  };
}
const entry = (qsoId: string, destinationId: LedgerEntry['destinationId'], state: LedgerEntry['state'], extra: Partial<LedgerEntry> = {}): LedgerEntry => ({ ...emptyEntry(qsoId, destinationId), state, ...extra });

describe('rows', () => {
  it('formats reports, frequency and the second line', () => {
    expect(reportText('-12')).toBe('−12');
    expect(reportText('+05')).toBe('+05');
    expect(reportText('')).toBe('?');
    expect(reportsText({ rstSent: '-12', rstRcvd: '-10' })).toBe('−12 / −10');
    expect(reportsText({ rstSent: '-12', rstRcvd: '' })).toBe('sent −12');
    expect(reportsText({ rstSent: ' ', rstRcvd: '+05' })).toBe('received +05');
    expect(reportsText({ rstSent: '', rstRcvd: '' })).toBe('');
    expect(freqText(14_075_500)).toBe('14.076');
    expect(freqText(null)).toBe('');
    const x = q('VK2ESN', NOW);
    expect(qsoLine(x)).toBe('20m FT8 · 14.076 · QF56 · −12 / −10');
    expect(qsoLine({ ...x, mode: 'MFSK', submode: 'FT4', freqHz: null, gridsquare: '', rstSent: '', rstRcvd: '' })).toBe('20m FT4');
    // A contest exchange follows the reports: class and section carry no report.
    expect(qsoLine({ ...x, rstSent: '', rstRcvd: '', stx: '1D WI', srx: '2B EMA' })).toBe('20m FT8 · 14.076 · QF56 · 1D WI / 2B EMA');
    expect(qsoLine({ ...x, rstSent: '579', rstRcvd: '559', stx: 'WI', srx: 'MA' })).toBe('20m FT8 · 14.076 · QF56 · 579 / 559 · WI / MA');
    expect(qsoLine({ ...x, rstRcvd: '' })).toBe('20m FT8 · 14.076 · QF56 · sent −12');
  });

  it('labels UTC days', () => {
    expect(dayLabel(NOW - 3_600_000, NOW)).toBe('Today · 13 Oct 2026');
    expect(dayLabel(Date.UTC(2026, 9, 12, 23, 59), NOW)).toBe('Yesterday · 12 Oct 2026');
    expect(dayLabel(Date.UTC(2026, 9, 11, 10), NOW)).toBe('11 Oct 2026');
    expect(shortDate(Date.UTC(2026, 9, 11, 10))).toBe('11 Oct');
  });

  it('groups QSOs by UTC day, newest first', () => {
    const list = [q('A', NOW - 1000), q('B', NOW - 2000), q('C', Date.UTC(2026, 9, 12, 23)), q('D', Date.UTC(2026, 9, 1))];
    expect(groupByDay(list, NOW).map((g) => [g.label, g.qsos.map((x) => x.call)])).toEqual([
      ['Today · 13 Oct 2026', ['A', 'B']],
      ['Yesterday · 12 Oct 2026', ['C']],
      ['1 Oct 2026', ['D']],
    ]);
  });

  it('searches by callsign, grid, reference and comment', () => {
    const x = q('VK2ESN', NOW, { comment: 'Nice signal', potaRef: 'US-1234', myPotaRef: 'VK-0921' });
    for (const t of ['vk2', 'qf56', 'us-1234', 'VK-0921', 'nice', '']) expect(matches(x, t)).toBe(true);
    expect(matches(x, 'JA1')).toBe(false);
  });
});

describe('status tags', () => {
  it('names each state', () => {
    expect(tagFor(entry('x', 'wavelog', 'waiting'), 'Wavelog')).toEqual({ destination: 'wavelog', state: 'waiting', text: 'Wavelog · waiting', label: 'Wavelog: waiting', tone: 'wait' });
    expect(tagFor(entry('x', 'wavelog', 'delivered'), 'Wavelog')).toMatchObject({ text: 'Wavelog', label: 'Wavelog: delivered', tone: 'ok' });
    expect(tagFor(entry('x', 'wavelog', 'refused'), 'Wavelog')).toMatchObject({ text: 'Wavelog · refused', tone: 'bad' });
    expect(tagFor(entry('x', 'wavelog', 'changed'), 'Wavelog')).toMatchObject({ text: 'Wavelog · changed', tone: 'wait' });
    expect(tagFor(entry('x', 'pota-file', 'file-ready'), 'POTA')).toMatchObject({ text: 'POTA · file ready', tone: 'wait' });
    expect(tagFor(entry('x', 'pota-file', 'submitted'), 'POTA')).toMatchObject({ text: 'POTA', label: 'POTA: submitted', tone: 'ok' });
    expect(tagFor(entry('x', 'wavelog', 'not-sent'), 'Wavelog')).toEqual({ destination: 'wavelog', state: 'not-sent', text: 'Wavelog · not sent', label: 'Wavelog: not sent', tone: 'idle' });
    expect(tagFor(entry('x', 'wavelog', 'not-needed'), 'Wavelog')).toBeNull();
  });

  it('shows direct destinations on rows and finds the entry a Fix acts on', () => {
    const es = [entry('x', 'wavelog', 'refused'), entry('x', 'pota-file', 'file-ready')];
    expect(rowTags(es, FACTS).map((t) => t.text)).toEqual(['Wavelog · refused']);
    expect(rowTags(es, FACTS.map((f) => ({ ...f, active: false })))).toEqual([]);
    expect(rowProblem(es, FACTS)?.destinationId).toBe('wavelog');
    expect(rowProblem([entry('x', 'wavelog', 'delivered')], FACTS)).toBeNull();
  });
});

describe('To do', () => {
  it('lists QSOs waiting, refused or changed at an active direct destination', () => {
    const a = q('A', NOW);
    const b = q('B', NOW);
    const c = q('C', NOW);
    const d = q('D', NOW, { deletedAt: NOW });
    const e = q('E', NOW);
    const ledger = [entry(a.id, 'wavelog', 'waiting'), entry(b.id, 'wavelog', 'delivered'), entry(c.id, 'wavelog', 'refused'), entry(d.id, 'wavelog', 'changed'), entry(e.id, 'pota-file', 'file-ready')];
    expect(todoQsos([a, b, c, d, e], byQso(ledger), FACTS).map((x) => x.call)).toEqual(['A', 'C', 'D']);
    const f = q('F', NOW);
    expect(todoQsos([f], byQso([entry(f.id, 'wavelog', 'not-sent')]), FACTS).map((x) => x.call)).toEqual(['F']);
    expect(todoQsos([a, b, c, d, e], byQso(ledger), FACTS.map((f) => ({ ...f, active: f.id !== 'wavelog' })))).toEqual([]);
  });
});

describe('activation cards', () => {
  const day = Date.UTC(2026, 9, 11, 18, 30);
  const qs = [q('A', day, {}, ACT), q('B', day + 1000, {}, ACT), q('C', day + 2000, {}, ACT), q('Z', day, {}, null)];
  const pota = (id: string, submittedAt: number | null, state: LedgerEntry['state'] = submittedAt ? 'submitted' : 'file-ready') =>
    entry(id, 'pota-file', state, { parts: [{ key: 'pota|VK-0921|20261011', submittedAt }] });
  const sota = (id: string, submittedAt: number | null) => entry(id, 'sota-file', submittedAt ? 'submitted' : 'file-ready', { parts: [{ key: 'sota|VK3/VC-012|20261011', submittedAt }] });
  const submitted = Date.UTC(2026, 9, 12, 9);

  it('summarises each destination for the activation', () => {
    const ledger = [
      entry(qs[0].id, 'wavelog', 'delivered'),
      entry(qs[1].id, 'wavelog', 'delivered'),
      entry(qs[2].id, 'wavelog', 'waiting'),
      ...qs.slice(0, 3).flatMap((x) => [pota(x.id, null), sota(x.id, submitted)]),
    ];
    const idx = byQso(ledger);
    const direct = activationDirect(ACT, qs, idx, FACTS);
    expect(direct).toEqual([{ destination: 'wavelog', name: 'Wavelog', total: 3, delivered: 2, notSent: 0, waiting: 1, refused: 0, changed: 0 }]);
    expect(directText(direct[0])).toBe('Wavelog: 2 of 3 delivered, 1 waiting');
    expect(directText({ ...direct[0], delivered: 3, waiting: 0 })).toBe('Wavelog: all 3 delivered');
    expect(directText({ ...direct[0], delivered: 1, notSent: 2, waiting: 0 })).toBe('Wavelog: 1 of 3 delivered, 2 not sent');
    const notSent = activationDirect(ACT, qs, byQso(qs.slice(0, 3).map((x) => entry(x.id, 'wavelog', 'not-sent'))), FACTS);
    expect(notSent[0]).toMatchObject({ notSent: 3, waiting: 0 });
    expect(afterLine(notSent, [])).toBe('Wavelog 3 not sent');
    const files = activationFiles(ACT, qs, idx, FACTS);
    expect(files.map(fileText)).toEqual(['POTA VK-0921, 11 Oct 2026: file ready', 'SOTA VK3/VC-012, 11 Oct 2026: submitted 12 Oct']);
    expect(files[0]).toMatchObject({ key: 'pota|VK-0921|20261011', destination: 'pota-file', count: 3, state: 'file-ready' });
    expect(afterLine(direct, files)).toBe('Wavelog 1 waiting · POTA file ready');
  });

  it('says a file changed after submission, and leaves out files of inactive destinations', () => {
    const ledger = [pota(qs[0].id, submitted, 'changed'), pota(qs[1].id, submitted), entry(qs[2].id, 'adif-file', 'file-ready', { parts: [{ key: 'adif|a', submittedAt: null }] })];
    const files = activationFiles(ACT, qs, byQso(ledger), FACTS);
    expect(files.map(fileText)).toEqual(['POTA VK-0921, 11 Oct 2026: changed after submission']);
  });

  it('writes the after-the-activation line', () => {
    const ready = (destination: 'pota-file' | 'sota-file' | 'adif-file', label: string) => ({ key: label, destination, label, state: 'file-ready' as const, count: 1, submittedAt: null });
    expect(afterLine([], [])).toBe('Nothing to send');
    expect(afterLine([{ destination: 'wavelog', name: 'Wavelog', total: 7, delivered: 0, notSent: 0, waiting: 7, refused: 0, changed: 0 }], [ready('pota-file', 'POTA VK-0921, 11 Oct 2026'), ready('sota-file', 'SOTA VK3/VC-012, 11 Oct 2026')])).toBe(
      'Wavelog 7 waiting · POTA and SOTA files ready',
    );
    expect(afterLine([{ destination: 'wavelog', name: 'Wavelog', total: 7, delivered: 6, notSent: 0, waiting: 0, refused: 1, changed: 0 }], [ready('pota-file', 'POTA A'), ready('pota-file', 'POTA B'), ready('sota-file', 'SOTA C'), ready('adif-file', 'ADIF')])).toBe(
      'Wavelog 1 refused · POTA, SOTA and ADIF files ready',
    );
    expect(afterLine([{ destination: 'wavelog', name: 'Wavelog', total: 7, delivered: 7, notSent: 0, waiting: 0, refused: 0, changed: 0 }], [])).toBe('Wavelog all delivered');
  });
});
