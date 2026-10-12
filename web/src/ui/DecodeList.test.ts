// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import DecodeList, { type DecodeListItem } from './DecodeList.svelte';
import { markDecode, type DecodeRowData } from '../lib/decode/marking';
import type { Decode } from '../lib/decode/types';

const MY = '9V1NE';
const d = (text: string, snr_db: number, dt_s: number, freq_hz: number): Decode => ({ text, snr_db, dt_s, freq_hz });
const row = (decode: Decode, extra: Partial<DecodeRowData> = {}, sent = false): DecodeRowData => ({ decode, ...markDecode(decode, MY, sent), ...extra });

/** The Operate screen in the mockup: one sent row, a slot header, four decodes. */
const FIXTURE: DecodeListItem[] = [
  { kind: 'row', id: 's1', row: row(d('JA1KXM 9V1NE R-14', 0, 0, 1180), { time: '13:14:30', meta: 'You sent' }, true) },
  { kind: 'header', id: 'h1', text: '13:14:15 UTC · 23 decodes · decoded in 0.38 s' },
  { kind: 'row', id: 'r1', row: row(d('9V1NE JA1KXM -09', -9, 0.2, 1418), { meta: 'Japan' }) },
  { kind: 'row', id: 'r2', row: row(d('CQ 9M2TRX OJ02', -7, 0.1, 1022), { meta: 'Worked', worked: true }) },
  { kind: 'row', id: 'r3', row: row(d('CQ POTA VK3QRP QF22', -15, 0.3, 1846), { badge: { text: 'New grid', tone: 'teal' } }) },
  { kind: 'row', id: 'r4', row: row(d('CQ 3D2KQ RH91', -21, 0.4, 641), { badge: { text: 'New DXCC', tone: 'mag' } }) },
  { kind: 'row', id: 'r5', row: row(d('JH1RRT YB0AZK RR73', -6, -0.2, 2210), { meta: 'Indonesia' }) },
];

let app: ReturnType<typeof mount> | null = null;

function render(items: DecodeListItem[]) {
  const target = document.createElement('div');
  document.body.append(target);
  app = mount(DecodeList, { target, props: { items } });
  flushSync();
  return target;
}

afterEach(() => {
  if (app) unmount(app);
  app = null;
  document.body.innerHTML = '';
});

describe('DecodeList', () => {
  it('renders one 40 px row per decode and the slot header', () => {
    const el = render(FIXTURE);
    expect(el.querySelectorAll('li.dr')).toHaveLength(6);
    expect(el.querySelector('li.slot-head')?.textContent).toBe('13:14:15 UTC · 23 decodes · decoded in 0.38 s');
    // Row height comes from the token, set to 40 px.
    const tokens = readFileSync(join(process.cwd(), 'src/styles/tokens.css'), 'utf8');
    expect(tokens).toMatch(/--rr-row-decode:\s*40px;/);
  });

  it('marks CQ green, my call red and what I sent amber', () => {
    const rows = [...render(FIXTURE).querySelectorAll('li.dr')];
    expect(rows.map((r) => ['k-cq', 'k-me', 'k-sent'].find((k) => r.classList.contains(k)) ?? null)).toEqual([
      'k-sent',
      'k-me',
      'k-cq',
      'k-cq',
      'k-cq',
      null,
    ]);
  });

  it('puts the other station in bold and keeps the message text exact', () => {
    const rows = [...render(FIXTURE).querySelectorAll('li.dr')];
    expect(rows.map((r) => r.querySelector('.c-msg b')?.textContent ?? null)).toEqual(['JA1KXM', 'JA1KXM', '9M2TRX', 'VK3QRP', '3D2KQ', null]);
    expect(rows.map((r) => r.querySelector('.c-msg')?.textContent)).toEqual([
      'JA1KXM 9V1NE R-14',
      '9V1NE JA1KXM -09',
      'CQ 9M2TRX OJ02',
      'CQ POTA VK3QRP QF22',
      'CQ 3D2KQ RH91',
      'JH1RRT YB0AZK RR73',
    ]);
  });

  it('writes SNR, DT and frequency as WSJT-X does, with the minus sign', () => {
    const r = render(FIXTURE).querySelectorAll('li.dr')[1];
    expect(r.querySelector('.c-db')?.textContent).toBe('−09');
    expect(r.querySelector('.c-dt')?.textContent).toBe('0.2');
    expect(r.querySelector('.c-hz')?.textContent).toBe('1418');
    const sent = render(FIXTURE).querySelector('li.dr');
    expect(sent?.querySelector('.c-time')?.textContent).toBe('13:14:30');
    expect(sent?.querySelector('.c-db')).toBeNull();
  });

  it('shows badges and notes, and dims worked stations', () => {
    const rows = [...render(FIXTURE).querySelectorAll('li.dr')];
    expect(rows[3].querySelector('.badge.teal')?.textContent).toBe('New grid');
    expect(rows[4].querySelector('.badge.mag')?.textContent).toBe('New DXCC');
    expect(rows[1].querySelector('.c-meta')?.textContent).toBe('Japan');
    expect(rows[2].classList.contains('worked')).toBe(true);
  });

  it('gives each row a spoken label', () => {
    const rows = [...render(FIXTURE).querySelectorAll('li.dr')];
    expect(rows[1].getAttribute('aria-label')).toBe('−09 dB, DT 0.2 s, 1418 Hz, 9V1NE JA1KXM -09, to you, Japan');
    expect(rows[0].getAttribute('aria-label')).toBe('13:14:30 UTC, 1180 Hz, JA1KXM 9V1NE R-14, you sent, You sent');
    expect(rows[3].getAttribute('aria-label')).toContain('calling CQ, New grid');
  });

  it('renders an empty list without rows', () => {
    const el = render([]);
    expect(el.querySelectorAll('li')).toHaveLength(0);
    expect(el.querySelector('ul')?.getAttribute('aria-label')).toBe('Decodes');
  });
});
