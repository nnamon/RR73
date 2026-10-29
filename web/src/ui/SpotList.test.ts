// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import SpotList from './SpotList.svelte';
import type { SpotFeedView } from '../lib/spots/feed.svelte';
import { parseHamqthCsv } from '../lib/spots/hamqth';
import { mergeSpots } from '../lib/spots/merge';
import { normalisePota } from '../lib/spots/pota';
import { SPOT_CLASSES, type Spot, type SpotBadge } from '../lib/spots/types';
import { NOW, PAIR_HAMQTH_0556, PAIR_POTA_0556, recorded, recordedText } from '../lib/testing/spots';

/** Both feeds recorded at 05:56 UTC, merged as the feed does. */
const SPOTS = mergeSpots([normalisePota(recorded(PAIR_POTA_0556))!.spots, parseHamqthCsv(recordedText(PAIR_HAMQTH_0556)).spots]);
const UPDATED = Date.UTC(2026, 9, 13, 5, 56, 0);

const BOTH: SpotFeedView = {
  sources: [
    { id: 'pota', name: 'POTA' },
    { id: 'hamqth', name: 'HamQTH' },
  ],
  classes: SPOT_CLASSES,
  online: true,
  updatedAt: UPDATED,
  loading: false,
  failing: [],
  credits: ['DX cluster data provided by HamQTH.com.'],
};
const POTA_ONLY: SpotFeedView = { ...BOTH, sources: [{ id: 'pota', name: 'POTA' }], classes: ['POTA'], credits: [] };

interface Props {
  spots?: readonly Spot[];
  feed?: SpotFeedView;
  myBands?: readonly string[];
  isNew?: ((s: Spot) => boolean) | null;
  badge?: ((s: Spot) => SpotBadge | null) | null;
  onGo?: (s: Spot) => void;
  canGo?: ((s: Spot) => boolean) | null;
}

let app: ReturnType<typeof mount> | null = null;

function render(p: Props = {}) {
  const target = document.createElement('div');
  document.body.append(target);
  app = mount(SpotList, { target, props: { spots: SPOTS, feed: BOTH, now: NOW, onGo: () => {}, ...p } });
  flushSync();
  return target;
}

const calls = (el: HTMLElement) => [...el.querySelectorAll('li.spot .call')].map((c) => c.textContent);
const chips = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>('button.chip')].map((b) => `${b.textContent}${b.getAttribute('aria-pressed') === 'true' ? ' on' : ''}`);
function chip(el: HTMLElement, label: string): HTMLButtonElement {
  const b = [...el.querySelectorAll<HTMLButtonElement>('button.chip')].find((x) => x.textContent === label);
  if (!b) throw new Error(`No chip ${label}`);
  return b;
}
function click(b: Element | null) {
  (b as HTMLElement).click();
  flushSync();
}
const row = (el: HTMLElement, call: string) => [...el.querySelectorAll('li.spot')].find((li) => li.querySelector('.call')?.textContent === call)!;

afterEach(() => {
  if (app) unmount(app);
  app = null;
  document.body.innerHTML = '';
});

describe('SpotList rows', () => {
  it('shows FT8, FT4 and LQ8 activation spots, newest first, by default', () => {
    expect(calls(render())).toEqual(['JE1QEV', 'KC5JEC', 'JL1VNI/P']);
  });

  it('writes callsign, frequency and mode, references and park, and age', () => {
    const r = row(render(), 'JE1QEV');
    expect(r.querySelector('.freq')?.textContent).toBe('430.512 FT8');
    expect(r.querySelector('.ref')?.textContent).toBe('POTA JP-1834 · Chichibu Muse Prefectural Park');
    expect(r.querySelector('.age')?.textContent).toBe('1 min');
    expect(r.querySelector('button.pick')?.getAttribute('aria-label')).toBe('JE1QEV, 430.512 MHz FT8, POTA JP-1834, Chichibu Muse Prefectural Park, 1 minute ago');
  });

  it('tags QRT spots, and takes tags from the badge hook first', () => {
    expect(row(render(), 'JL1VNI/P').querySelector('.badge.muted')?.textContent).toBe('QRT');
    unmount(app!);
    const el = render({ badge: (s) => (s.activator === 'JE1QEV' ? { text: 'New park', tone: 'teal' } : null) });
    expect(row(el, 'JE1QEV').querySelector('.badge.teal')?.textContent).toBe('New park');
    expect(row(el, 'KC5JEC').querySelector('.badge')).toBeNull();
    expect(row(el, 'JL1VNI/P').querySelector('.badge')?.textContent).toBe('QRT');
  });

  it('opens a row with who spotted it and Go, and closes it on a second tap', () => {
    const el = render();
    const pick = row(el, 'KC5JEC').querySelector('button.pick')!;
    expect(pick.getAttribute('aria-expanded')).toBe('false');
    click(pick);
    expect(pick.getAttribute('aria-expanded')).toBe('true');
    expect(row(el, 'KC5JEC').classList.contains('open')).toBe(true);
    expect(row(el, 'KC5JEC').querySelector('.by')?.textContent?.trim()).toBe('Spotted by WE9V (RBN) at 05:52 UTC · −16 dB');
    expect(el.querySelectorAll('button.go')).toHaveLength(1);
    click(pick);
    expect(el.querySelectorAll('button.go')).toHaveLength(0);
  });

  it('opens one row at a time and shows a person’s comments', () => {
    const el = render();
    click(row(el, 'KC5JEC').querySelector('button.pick'));
    click(row(el, 'JL1VNI/P').querySelector('button.pick'));
    expect(el.querySelectorAll('li.spot.open')).toHaveLength(1);
    expect(row(el, 'JL1VNI/P').querySelector('.note')?.textContent).toBe('QRT');
  });

  it('leaves Go out of a spot canGo refuses', () => {
    const el = render({ canGo: (s) => s.activator !== 'KC5JEC' });
    click(row(el, 'KC5JEC').querySelector('button.pick'));
    expect(row(el, 'KC5JEC').querySelector('.by')).not.toBeNull();
    expect(el.querySelectorAll('button.go')).toHaveLength(0);
    click(row(el, 'JE1QEV').querySelector('button.pick'));
    expect(el.querySelectorAll('button.go')).toHaveLength(1);
  });

  it('hands the spot to onGo', () => {
    const onGo = vi.fn();
    const el = render({ onGo });
    click(row(el, 'JE1QEV').querySelector('button.pick'));
    const go = el.querySelector('button.go')!;
    expect(go.textContent).toBe('Go');
    expect(go.getAttribute('aria-label')).toBe('Go to JE1QEV');
    click(go);
    expect(onGo).toHaveBeenCalledOnce();
    expect(onGo.mock.calls[0][0]).toMatchObject({ activator: 'JE1QEV', freqHz: 430_512_000, digital: 'FT8', refs: [{ ref: 'JP-1834' }] });
  });
});

describe('SpotList chips', () => {
  it('shows class chips only with more than one class, and My bands and New only when supplied', () => {
    expect(chips(render({ feed: POTA_ONLY }))).toEqual(['FT8, FT4, LQ8 on']);
    unmount(app!);
    expect(chips(render({ myBands: ['40m'], isNew: () => true }))).toEqual(['POTA on', 'SOTA on', 'WWFF on', 'IOTA on', 'DX', 'FT8, FT4, LQ8 on', 'My bands', 'New only']);
  });

  it('adds DX spots with DX, and every mode with FT8, FT4, LQ8 off', () => {
    const el = render();
    click(chip(el, 'DX'));
    expect(chip(el, 'DX').getAttribute('aria-pressed')).toBe('true');
    expect(calls(el)).toEqual(['JE1QEV', 'DL9DBJ', 'KC5JEC', 'JL1VNI/P']);
    click(chip(el, 'DX'));
    click(chip(el, 'FT8, FT4, LQ8'));
    expect(calls(el)).toEqual(['ZL1KS', 'JE1QEV', 'KC5JEC', 'JL1VNI/P', 'PD4US/P']);
    expect(row(el, 'ZL1KS').querySelector('.ref')?.textContent).toBe('POTA NZ-0008, IOTA OC-134 · Long Bay Regional Park');
  });

  it('filters to the operator bands and to new stations', () => {
    const el = render({ myBands: ['40m', '70cm'], isNew: (s) => s.activator !== 'JE1QEV' });
    click(chip(el, 'My bands'));
    expect(calls(el)).toEqual(['JE1QEV', 'JL1VNI/P']);
    click(chip(el, 'New only'));
    expect(calls(el)).toEqual(['JL1VNI/P']);
  });

  it('says which filters hide everything', () => {
    const el = render({ myBands: ['15m'] });
    click(chip(el, 'My bands'));
    expect(el.querySelector('.none')?.textContent).toBe('No FT8, FT4 or LQ8 activation spots on your bands.');
    for (const c of ['POTA', 'SOTA', 'WWFF', 'IOTA']) click(chip(el, c));
    expect(el.querySelector('.none')?.textContent).toBe('Choose POTA, SOTA, WWFF, IOTA or DX to see spots.');
  });
});

describe('SpotList states', () => {
  it('says when the list was updated and credits HamQTH', () => {
    const el = render();
    expect([...el.querySelectorAll('p.status')].map((p) => p.textContent)).toEqual([
      'Updated 05:56 UTC',
      'DX cluster data provided by HamQTH.com.',
    ]);
  });

  it('keeps the list offline and says how old it is', () => {
    const el = render({ feed: { ...BOTH, online: false } });
    expect(calls(el)).toHaveLength(3);
    expect(el.querySelector('p.status')?.textContent).toBe('Offline. The list is from 05:56 UTC and refreshes when the phone is back online.');
  });

  it('says what happens before the first list', () => {
    expect(render({ spots: [], feed: { ...BOTH, updatedAt: null, loading: true } }).querySelector('.none')?.textContent).toBe('Fetching spots.');
    unmount(app!);
    const offline = render({ spots: [], feed: { ...BOTH, updatedAt: null, online: false } });
    expect(offline.querySelector('.none')?.textContent).toBe('Spots appear here when the phone is back online.');
    expect([...offline.querySelectorAll('p.status')].map((p) => p.textContent)).toEqual(['DX cluster data provided by HamQTH.com.']);
  });

  it('explains a failure and the next try', () => {
    const feed: SpotFeedView = { ...BOTH, failing: [{ source: 'hamqth', name: 'HamQTH', kind: 'http', status: 503, afterMs: null, retryAt: Date.UTC(2026, 9, 13, 5, 59) }] };
    expect(render({ feed }).querySelector('p.status')?.textContent).toBe('HamQTH answered with error 503. Showing spots from 05:56 UTC. Next try at 05:59 UTC.');
  });

  it('says how to turn spots on, without chips or status, while every source is off', () => {
    const el = render({ spots: [], feed: { ...BOTH, sources: [], classes: [], credits: [], updatedAt: null } });
    expect(el.querySelector('.none')?.textContent).toBe('Spots are off. Turn on POTA spots or Cluster spots in Settings › Optional features.');
    expect(el.querySelectorAll('button')).toHaveLength(0);
    expect(el.querySelectorAll('p.status')).toHaveLength(0);
  });
});
