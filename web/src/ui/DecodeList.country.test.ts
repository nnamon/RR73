// @vitest-environment jsdom
// The caller's country on CQ rows. Layout (the ellipsis and the drop-out) needs a browser:
// e2e/country.spec.ts measures it.
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import DecodeList, { type DecodeListItem } from './DecodeList.svelte';
import { markDecode, type DecodeRowData } from '../lib/decode/marking';
import type { Decode } from '../lib/decode/types';
import { DxccIndex } from '../lib/reference';

const MY = '9V1NE';
const d = (text: string, snr_db: number, dt_s: number, freq_hz: number): Decode => ({ text, snr_db, dt_s, freq_hz });
const row = (decode: Decode, extra: Partial<DecodeRowData> = {}, sent = false): DecodeRowData => ({ decode, ...markDecode(decode, MY, sent), ...extra });
const slotStartMs = Date.UTC(2026, 9, 13, 13, 14, 15);

let app: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (app) unmount(app);
  app = null;
  document.body.innerHTML = '';
});

describe('the country on CQ rows', () => {
  const countries = DxccIndex.fromJson({
    format: 1,
    version: '2026-09-15',
    source: 'test',
    notice: 'MIT',
    entities: [
      { name: 'Australia', prefix: 'VK', wae: false, dxcc: 150, cq: 30, itu: 59, cont: 'OC', lat: -23.7, lon: 132.33, utc: 10, aliases: 'VK' },
      { name: 'Japan', prefix: 'JA', wae: false, dxcc: 339, cq: 25, itu: 45, cont: 'AS', lat: 36.4, lon: 138.38, utc: 9, aliases: 'JA' },
      { name: 'Fed. Rep. of Germany', prefix: 'DL', wae: false, dxcc: 230, cq: 14, itu: 28, cont: 'EU', lat: 51, lon: 10, utc: 1, aliases: 'DL' },
    ],
  });
  const items: DecodeListItem[] = [
    { kind: 'row', id: 's', slotStartMs, row: row(d('CQ 9V1NE OJ11', 0, 0, 1500), { time: '13:14:30' }, true), out: { stage: 'sent', startMs: slotStartMs + 15500 } },
    { kind: 'row', id: 'a', slotStartMs, row: row(d('CQ VK2LAW QF56', -11, 0.1, 763), { hl: 'cq' }) },
    { kind: 'row', id: 'b', slotStartMs, row: row(d('JA1XYZ VK2LAW -09', -14, 0, 2225)) },
    { kind: 'row', id: 'c', slotStartMs, row: row(d('VK2LAW 9V1NE QF56', -9, 0, 1180)) },
    { kind: 'row', id: 'd', slotStartMs, row: row(d('CQ DX DL1ABC JO62', -3, 0.2, 1438)), old: true },
    { kind: 'row', id: 'e', slotStartMs, row: row(d('CQ Q1ABC JO01', -8, 0, 900)) },
  ];

  function renderWith(props: Record<string, unknown>) {
    const target = document.createElement('div');
    document.body.append(target);
    app = mount(DecodeList, { target, props: { items, ...props } });
    flushSync();
    return [...target.querySelectorAll<HTMLElement>('button.dr')];
  }

  it('names the country of the station calling CQ, between the message and the numbers', () => {
    const rows = renderWith({ countries });
    expect(rows.map((r) => r.querySelector('.c-country')?.textContent ?? null)).toEqual([null, 'Australia', null, null, 'Germany', null]);
    const cells = [...rows[1].children].map((c) => c.classList[0]);
    expect(cells).toEqual(['c-msg', 'c-country', 'c-num']);
    // The whole message stays: the country takes the space after it.
    expect(rows[1].querySelector('.c-msg')?.textContent).toBe('CQ VK2LAW QF56');
    expect(rows[1].querySelector('.c-num')?.textContent).toBe('−11 dB · 763 Hz');
  });

  it('gives way to the reference of the station chased from Spots, on every row from it, and says it', () => {
    const chased: DecodeListItem[] = [
      { kind: 'row', id: 'c1', slotStartMs, row: row(d('CQ POTA JA1KXM PM95', -12, 0.1, 1418)) },
      { kind: 'row', id: 'c2', slotStartMs, row: row(d('W1AW JA1KXM/P RR73', -11, 0.1, 1418)) },
      { kind: 'row', id: 'c3', slotStartMs, row: row(d('CQ VK2LAW QF56', -11, 0.1, 763)) },
    ];
    const chase = { call: 'JA1KXM/P', text: 'JA-1234', spoken: 'spotted, POTA JA-1234' };
    const target = document.createElement('div');
    document.body.append(target);
    app = mount(DecodeList, { target, props: { items: chased, countries, chase } });
    flushSync();
    const rows = [...target.querySelectorAll<HTMLElement>('button.dr')];
    expect(rows.map((r) => r.querySelector('[data-testid="chase-tag"]')?.textContent ?? null)).toEqual(['JA-1234', 'JA-1234', null]);
    expect(rows.map((r) => r.querySelector('.c-country')?.textContent ?? null)).toEqual([null, null, 'Australia']);
    expect(rows[0].getAttribute('aria-label')).toBe('−12 dB, DT 0.1 s, 1418 Hz, CQ POTA JA1KXM PM95, calling CQ, spotted, POTA JA-1234');
    expect(rows[2].getAttribute('aria-label')).not.toContain('spotted');
  });

  it('reads the country after the CQ, on faded rows too', () => {
    const rows = renderWith({ countries });
    expect(rows[1].getAttribute('aria-label')).toBe('−11 dB, DT 0.1 s, 763 Hz, CQ VK2LAW QF56, calling CQ, Australia');
    expect(rows[4].classList.contains('old')).toBe(true);
    expect(rows[4].getAttribute('aria-label')).toContain('calling CQ, Germany');
    expect(rows[2].getAttribute('aria-label')).not.toContain('Australia');
  });

  it('shows no country before the country file has loaded', () => {
    const rows = renderWith({});
    expect(rows.map((r) => r.querySelector('.c-country'))).toEqual(rows.map(() => null));
    expect(rows[1].getAttribute('aria-label')).toBe('−11 dB, DT 0.1 s, 763 Hz, CQ VK2LAW QF56, calling CQ');
  });
});
