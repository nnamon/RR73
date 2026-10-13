// A page for SpotList's layout and accessibility tests: the list in the Spots screen's frame, fed
// from the responses recorded on 13 October 2026. ?state= picks what it shows; Go writes the
// spot's callsign to <body data-go>.
import '../../src/styles/base.css';
import './demo.css';
import { mount } from 'svelte';
import SpotList from '../../src/ui/SpotList.svelte';
import type { SpotFeedView } from '../../src/lib/spots/feed.svelte';
import { defaultFilter, spotKey, type SpotFilter } from '../../src/lib/spots/filter';
import { parseHamqthCsv } from '../../src/lib/spots/hamqth';
import { mergeSpots } from '../../src/lib/spots/merge';
import { normalisePota } from '../../src/lib/spots/pota';
import { SPOT_CLASSES, type Spot, type SpotBadge } from '../../src/lib/spots/types';
import pota from '../../../fixtures/spots/pair-pota-2026-10-13T0556Z.json';
import clusterCsv from '../../../fixtures/spots/hamqth-dxc-2026-10-13T0554Z.csv?raw';
import pairCsv from '../../../fixtures/spots/pair-hamqth-dxc-2026-10-13T0556Z.csv?raw';

export const NOW = Date.UTC(2026, 9, 13, 5, 57, 0);
const UPDATED = Date.UTC(2026, 9, 13, 5, 56, 0);

const recorded = mergeSpots([normalisePota(pota)!.spots, [...parseHamqthCsv(pairCsv).spots, ...parseHamqthCsv(clusterCsv).spots]]);

/** The widest row a phone should meet: a long portable call, a badge, a microwave frequency, two references. */
const long: Spot = {
  ...recorded[0],
  id: 'demo:long',
  source: 'hamqth',
  activator: 'VK3/9V1NE/QRP',
  refs: [
    { programme: 'POTA', ref: 'AU-10921', name: 'Example national park with a long name' },
    { programme: 'WWFF', ref: 'VKFF-0921', name: '' },
  ],
  freqHz: 10_489_770_000,
  band: '3cm',
  mode: '',
  digital: 'FT8',
  spottedAt: NOW - 30_000,
  comments: 'FT8 via QO-100, calling CQ every even slot, 73 and thanks for all the contacts today',
};

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

const all: SpotFilter = { ...defaultFilter(), classes: SPOT_CLASSES, digitalOnly: false };
const BADGES: Record<string, SpotBadge> = {
  JE1QEV: { text: 'New park', tone: 'teal' },
  KC5JEC: { text: 'Worked today', tone: 'muted' },
  'VK3/9V1NE/QRP': { text: 'Worked today', tone: 'muted' },
};
const badge = (s: Spot): SpotBadge | null => BADGES[s.activator] ?? null;

interface State {
  spots: readonly Spot[];
  feed: SpotFeedView;
  filter?: SpotFilter;
  selected?: string;
}

const je1qev = recorded.find((s) => s.activator === 'JE1QEV')!;

const STATES: Record<string, State> = {
  list: { spots: recorded, feed: BOTH },
  open: { spots: recorded, feed: BOTH, selected: spotKey(je1qev) },
  all: { spots: recorded, feed: BOTH, filter: all },
  long: { spots: [long, ...recorded], feed: BOTH, filter: { ...all, digitalOnly: true }, selected: spotKey(long) },
  empty: { spots: recorded, feed: BOTH, filter: { ...defaultFilter(), classes: ['SOTA'] } },
  offline: { spots: recorded, feed: { ...BOTH, online: false } },
  loading: { spots: [], feed: { ...BOTH, updatedAt: null, loading: true } },
  error: { spots: recorded, feed: { ...BOTH, failing: [{ source: 'hamqth', name: 'HamQTH', kind: 'http', status: 503, afterMs: null, retryAt: Date.UTC(2026, 9, 13, 5, 59) }] } },
  off: { spots: [], feed: { ...BOTH, sources: [], classes: [], credits: [], updatedAt: null } },
  pota: { spots: recorded.filter((s) => s.source === 'pota'), feed: { ...BOTH, sources: [{ id: 'pota', name: 'POTA' }], classes: ['POTA'], credits: [] } },
};

const state = STATES[new URLSearchParams(location.search).get('state') ?? 'list'] ?? STATES.list;

const app = document.getElementById('app')!;
app.innerHTML = `
  <div class="frame">
    <main class="main" id="main">
      <div class="pane scroll">
        <section class="screen" aria-labelledby="spots-title">
          <h1 id="spots-title" class="large-title">Spots</h1>
          <div class="section">
            <h2 class="section-head">Spots</h2>
            <div id="list"></div>
          </div>
        </section>
      </div>
    </main>
  </div>`;

mount(SpotList, {
  target: document.getElementById('list')!,
  props: {
    spots: state.spots,
    feed: state.feed,
    now: NOW,
    filter: state.filter ?? defaultFilter(),
    selected: state.selected ?? null,
    myBands: ['20m', '40m', '80m', '70cm'],
    isNew: (s: Spot) => s.activator !== 'KC5JEC',
    badge,
    onGo: (s: Spot) => {
      document.body.dataset.go = s.activator;
    },
  },
});
document.body.dataset.ready = 'true';
