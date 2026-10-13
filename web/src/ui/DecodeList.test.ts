// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import DecodeList, { type DecodeListItem } from './DecodeList.svelte';
import { markDecode, type DecodeRowData } from '../lib/decode/marking';
import type { Decode } from '../lib/decode/types';

const MY = '9V1NE';
const d = (text: string, snr_db: number, dt_s: number, freq_hz: number): Decode => ({ text, snr_db, dt_s, freq_hz });
const row = (decode: Decode, extra: Partial<DecodeRowData> = {}, sent = false): DecodeRowData => ({ decode, ...markDecode(decode, MY, sent), ...extra });
const slotStartMs = Date.UTC(2026, 9, 13, 13, 14, 15);

/** The Operate screen in the mockup: one sent row, a slot bar, five decodes. */
const FIXTURE: DecodeListItem[] = [
  { kind: 'row', id: 's1', slotStartMs, row: row(d('JA1KXM 9V1NE R-14', 0, 0, 1180), { time: '13:14:30' }, true), out: { stage: 'sent', startMs: slotStartMs + 15500 } },
  { kind: 'header', id: 'h1', time: '13:14:15', detail: '23 decodes', parity: 'odd', text: '13:14:15 UTC · 23 decodes' },
  { kind: 'row', id: 'r1', slotStartMs, row: row(d('9V1NE JA1KXM -09', -9, 0.2, 1418), { meta: 'Japan' }) },
  { kind: 'row', id: 'r2', slotStartMs, row: row(d('CQ 9M2TRX OJ02', -7, 0.1, 1022), { meta: 'Worked', worked: true }) },
  { kind: 'row', id: 'r3', slotStartMs, row: row(d('CQ POTA VK3QRP QF22', -15, 0.3, 1846), { badge: { text: 'New grid', tone: 'teal' } }) },
  { kind: 'row', id: 'r4', slotStartMs, row: row(d('CQ 3D2KQ RH91', -21, 0.4, 641), { badge: { text: 'New DXCC', tone: 'mag' } }) },
  { kind: 'row', id: 'r5', slotStartMs, row: row(d('JH1RRT YB0AZK RR73', -6, -0.2, 2210), { meta: 'Indonesia' }) },
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
  it('renders one 32 px row per decode and a 22 px bar per slot', () => {
    const el = render(FIXTURE);
    expect(el.querySelectorAll('button.dr')).toHaveLength(6);
    const bar = el.querySelector('li.slot-bar');
    expect(bar?.classList.contains('odd')).toBe(true);
    expect([...(bar?.querySelectorAll('[aria-hidden=true]') ?? [])].map((s) => s.textContent)).toEqual(['13:14:15', '23 decodes', 'Odd']);
    expect(bar?.querySelector('.visually-hidden')?.textContent).toBe('13:14:15 UTC · 23 decodes, odd slot');
    // Heights come from the tokens.
    const tokens = readFileSync(join(process.cwd(), 'src/styles/tokens.css'), 'utf8');
    expect(tokens).toMatch(/--rr-row-decode:\s*32px;/);
    expect(tokens).toMatch(/--rr-slot-bar:\s*22px;/);
  });

  it('marks CQ green, my call red and what I sent amber', () => {
    const rows = [...render(FIXTURE).querySelectorAll('button.dr')];
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
    const rows = [...render(FIXTURE).querySelectorAll('button.dr')];
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

  it('writes SNR and frequency with their units after the message, and leaves DT to the details', () => {
    const r = render(FIXTURE).querySelectorAll('button.dr')[1];
    // 0.8.0 wrote "−09 0.2 1418" in three narrow columns, where "−0.8" ran into the frequency.
    expect(r.querySelector('.c-num')?.textContent).toBe('−09 dB · 1418 Hz');
    expect(r.querySelector('.c-db')?.textContent).toBe('−09 dB');
    expect(r.querySelector('.c-hz')?.textContent).toBe('1418 Hz');
    expect(r.querySelector('.c-dt')).toBeNull();
    expect(r.firstElementChild?.className).toContain('c-msg');
    const sent = render(FIXTURE).querySelector('button.dr');
    expect(sent?.querySelector('.c-tag')?.textContent).toBe('Sent');
    expect(sent?.querySelector('.c-num')?.textContent).toBe('1180 Hz');
  });

  it('puts the station a weight heavier only in a CQ', () => {
    const rows = [...render(FIXTURE).querySelectorAll('button.dr')];
    expect(rows.map((r) => r.classList.contains('k-cq'))).toEqual([false, false, true, true, true, false]);
  });

  it('shows badges and notes, and dims worked stations', () => {
    const rows = [...render(FIXTURE).querySelectorAll('button.dr')];
    expect(rows[3].querySelector('.badge.teal')?.textContent).toBe('New grid');
    expect(rows[4].querySelector('.badge.mag')?.textContent).toBe('New DXCC');
    expect(rows[1].querySelector('.c-meta')?.textContent).toBe('Japan');
    expect(rows[2].classList.contains('worked')).toBe(true);
  });

  it('gives each row a spoken label', () => {
    const rows = [...render(FIXTURE).querySelectorAll('button.dr')];
    expect(rows[1].getAttribute('aria-label')).toBe('−09 dB, DT 0.2 s, 1418 Hz, 9V1NE JA1KXM -09, to you, Japan');
    expect(rows[0].getAttribute('aria-label')).toBe('Sent, 13:14:30 UTC, 1180 Hz, JA1KXM 9V1NE R-14');
    expect(rows[3].getAttribute('aria-label')).toContain('calling CQ, New grid');
  });

  it('renders an empty list without rows', () => {
    const el = render([]);
    expect(el.querySelectorAll('li')).toHaveLength(0);
    expect(el.querySelector('ul')?.getAttribute('aria-label')).toBe('Decodes');
  });
});

describe('our transmission and older slots', () => {
  const at = slotStartMs + 15000;
  const sentRow = row(d('CQ 9V1NE OJ11', 0, 0, 1500), { time: '13:14:30' }, true);

  function renderAt(items: DecodeListItem[], nowMs: number) {
    const target = document.createElement('div');
    document.body.append(target);
    app = mount(DecodeList, { target, props: { items, nowMs } });
    flushSync();
    return target;
  }

  it('shows Next with a countdown, as a row that takes no taps', () => {
    const el = renderAt([{ kind: 'row', id: 'n1', slotStartMs: at, row: { ...sentRow, hl: null }, out: { stage: 'next', startMs: at + 500 } }], at - 5600);
    const next = el.querySelector('[data-testid=next-row]');
    expect(next?.tagName).toBe('DIV');
    expect(next?.classList.contains('next')).toBe(true);
    expect(next?.querySelector('.c-tag')?.textContent).toBe('Next · :30');
    expect(next?.querySelector('.c-when')?.textContent).toBe('in 7 s');
    expect(next?.querySelector('.visually-hidden')?.textContent).toBe('Next, :30, 13:14:30 UTC, in 7 s, CQ 9V1NE OJ11');
    expect(el.querySelector('button')).toBeNull();
  });

  it('shows Sending with a red line for the share on air', () => {
    const el = renderAt([{ kind: 'row', id: 's1', slotStartMs: at, row: { ...sentRow, hl: 'sent' }, out: { stage: 'sending', startMs: at + 500, endMs: at + 500 + 12640 } }], at + 500 + 3160);
    const r = el.querySelector('button.dr');
    expect(r?.classList.contains('sending')).toBe(true);
    expect(r?.querySelector('.c-tag')?.textContent).toBe('Sending');
    expect((r?.querySelector('.prog') as HTMLElement).style.width).toBe('25%');
  });

  it('fades rows of older slots, with a grey that reads on their tint', () => {
    const el = render([
      { kind: 'row', id: 'a', slotStartMs, row: row(d('CQ 9M2TRX OJ02', -12, 0.3, 1310), { hl: 'cq' }), old: true },
      { kind: 'row', id: 'b', slotStartMs, row: row(d('JG1FVM E27CJS RRR', 3, 0.1, 531)), old: true },
      { kind: 'row', id: 'c', slotStartMs, row: row(d('CQ A41ZZ LL93', -4, 0.2, 956), { hl: 'cq' }) },
    ]);
    const [a, b, c] = [...el.querySelectorAll<HTMLElement>('button.dr')];
    expect([a, b, c].map((r) => r.classList.contains('old'))).toEqual([true, true, false]);
    expect(a.style.getPropertyValue('--rr-ink-light')).toMatch(/^#[0-9A-F]{6}$/);
    expect(c.style.getPropertyValue('--rr-ink-light')).toBe('');
  });
});

describe('DecodeList gestures', () => {
  function renderWith(handlers: Record<string, (i: unknown) => void>) {
    const target = document.createElement('div');
    document.body.append(target);
    app = mount(DecodeList, { target, props: { items: FIXTURE, ...handlers } });
    flushSync();
    return [...target.querySelectorAll<HTMLButtonElement>('button.dr')];
  }

  it('selects on a tap and calls on a double-tap', () => {
    const seen: string[] = [];
    const rows = renderWith({ onselect: (i) => seen.push(`select ${(i as { id: string }).id}`), oncall: (i) => seen.push(`call ${(i as { id: string }).id}`) });
    rows[2].click();
    rows[2].click();
    rows[3].click();
    expect(seen).toEqual(['select r2', 'call r2', 'select r3']);
  });

  it('opens details on touch and hold, without selecting', async () => {
    vi.useFakeTimers();
    const seen: string[] = [];
    const rows = renderWith({ onselect: () => seen.push('select'), ondetail: (i) => seen.push(`detail ${(i as { id: string }).id}`) });
    rows[1].dispatchEvent(new PointerEvent('pointerdown', { clientX: 10, clientY: 10, bubbles: true }));
    vi.advanceTimersByTime(520);
    rows[1].dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    rows[1].click();
    expect(seen).toEqual(['detail r1']);
    vi.useRealTimers();
  });

  it('does not open details when the finger moves away to scroll', () => {
    vi.useFakeTimers();
    const seen: string[] = [];
    const rows = renderWith({ ondetail: () => seen.push('detail') });
    rows[1].dispatchEvent(new PointerEvent('pointerdown', { clientX: 10, clientY: 10, bubbles: true }));
    rows[1].dispatchEvent(new PointerEvent('pointermove', { clientX: 10, clientY: 40, bubbles: true }));
    vi.advanceTimersByTime(600);
    expect(seen).toEqual([]);
    vi.useRealTimers();
  });

  it('marks the selected row', () => {
    const target = document.createElement('div');
    document.body.append(target);
    app = mount(DecodeList, { target, props: { items: FIXTURE, selectedId: 'r3' } });
    flushSync();
    const sel = target.querySelectorAll('button.dr.sel');
    expect(sel).toHaveLength(1);
    expect(sel[0].getAttribute('aria-pressed')).toBe('true');
  });
});

describe('decode colours', () => {
  it('puts the background and the text layer on the row as classes, data and colours', () => {
    const target = render([
      { kind: 'row', id: 'a', slotStartMs, row: row(d('CQ 9M2TRX OJ02', -12, 0.3, 1310), { hl: 'cq', ink: 'worked' }) },
      { kind: 'row', id: 'b', slotStartMs, row: row(d('CQ A41ZZ LL93', -4, 0.2, 956), { hl: 'newGrid' }) },
      { kind: 'row', id: 'c', slotStartMs, row: row(d('JG1FVM E27CJS RRR', 3, 0.1, 531)) },
    ]);
    const [a, b, c] = [...target.querySelectorAll<HTMLElement>('button.dr')];
    expect(a.dataset).toMatchObject({ hl: 'cq', ink: 'worked' });
    expect(a.classList.contains('hl-background') && a.classList.contains('hl-ink')).toBe(true);
    expect(a.style.getPropertyValue('--rr-hl')).toBe('#66FF66');
    expect(a.style.getPropertyValue('--rr-ink-light')).toMatch(/^#[0-9A-F]{6}$/);
    expect(a.getAttribute('aria-label')).toContain('calling CQ, worked before');
    expect(b.dataset.ink).toBeUndefined();
    expect(b.getAttribute('aria-label')).toContain('new grid');
    expect(c.className).not.toMatch(/hl-/);
  });
});

describe('messages to you and the focus during a QSO', () => {
  it('gives a message to you its own class over its decode colour', () => {
    const target = render([
      { kind: 'row', id: 'a', slotStartMs, row: row(d('9V1NE JA1KXM -09', -9, 0.2, 1418), { hl: 'myCall' }), toYou: true },
      { kind: 'row', id: 'b', slotStartMs, row: row(d('JA1KXM 9V1NE R-14', -9, 0.2, 1418)), old: true, toYou: true },
      { kind: 'row', id: 'c', slotStartMs, row: row(d('CQ A41ZZ LL93', -4, 0.2, 956), { hl: 'cq' }) },
    ]);
    const [a, b, c] = [...target.querySelectorAll<HTMLElement>('button.dr')];
    expect(a.classList.contains('to-you') && a.classList.contains('hl-background')).toBe(true);
    expect(b.classList.contains('to-you') && b.classList.contains('old')).toBe(true);
    expect(c.classList.contains('to-you')).toBe(false);
  });

  it('dims rows marked by the focus, and slot bars never', () => {
    const target = render([
      { kind: 'header', id: 'h', time: '13:14:15', detail: '2 decodes', parity: 'odd', text: '13:14:15 UTC · 2 decodes' },
      { kind: 'row', id: 'a', slotStartMs, row: row(d('CQ A41ZZ LL93', -4, 0.2, 956)), dim: true },
      { kind: 'row', id: 'b', slotStartMs, row: row(d('CQ VJ6X OF78', -4, 0.2, 506)) },
    ]);
    const [a, b] = [...target.querySelectorAll<HTMLElement>('button.dr')];
    expect(a.classList.contains('dim')).toBe(true);
    expect(b.classList.contains('dim')).toBe(false);
    expect(target.querySelector('li.slot-bar')?.className).not.toMatch(/dim/);
    // The dim level is a token, raised with Increase Contrast.
    const tokens = readFileSync(join(process.cwd(), 'src/styles/tokens.css'), 'utf8');
    expect(tokens).toMatch(/--rr-focus-dim:\s*0\.4;/);
    expect(tokens).toMatch(/@media \(prefers-contrast: more\) \{\s*:root \{\s*--rr-focus-dim:\s*0\.6;/);
  });
});
