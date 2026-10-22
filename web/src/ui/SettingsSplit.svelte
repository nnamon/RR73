<script lang="ts">
  /**
   * Settings in compact height and regular width, as iPadOS Settings: the sections on the left,
   * each phone group a section and a group of one row that row, with the values that matter; the
   * chosen section or sub-screen on the right, in a column of at most 680 pt. On a phone on its
   * side a bar back to Operate runs across the top.
   */
  import type { Snippet } from 'svelte';
  import BackLink from './BackLink.svelte';
  import Icon from './Icon.svelte';
  import type { IconName } from './icons';
  import { layout } from '../lib/app/layout.svelte';
  import { href, route } from '../lib/app/router.svelte';
  import { presetLabel, presetOf } from '../lib/decode/highlight';
  import { practice } from '../lib/state/practice.svelte';
  import { relay, relayName } from '../lib/state/relay.svelte';
  import { pskReporter } from '../lib/state/pskreporter.svelte';
  import { settings } from '../lib/state/settings.svelte';
  import { audio } from '../lib/state/station.svelte';
  import { loggingSummary } from '../lib/state/summaries';
  import { catSupported } from '../lib/state/cat.svelte';
  import { rigSummary } from '../lib/state/radio.svelte';

  /** Rig control needs Web Serial: desktop Chrome and Edge. */
  const rigShown = catSupported();

  let { children }: { children: Snippet } = $props();

  interface Item {
    id: string;
    title: string;
    icon: IconName;
    tile: 'blue' | 'indigo' | 'orange' | 'green' | 'teal' | 'grey';
    value?: string;
  }

  const THEMES = { system: 'System', light: 'Light', dark: 'Dark', sun: 'Sun' } as const;

  const groups = $derived<Item[][]>([
    [
      { id: 'station', title: 'Station', icon: 'person', tile: 'blue', value: settings.callsign || 'Required' },
      { id: 'ft8', title: 'FT8 and FT4', icon: 'wave', tile: 'indigo' },
      { id: 'wspr', title: 'WSPR', icon: 'antenna', tile: 'indigo', value: `${settings.wspr.txPct}% · ${settings.wspr.powerDbm} dBm` },
      { id: 'rtty', title: 'RTTY', icon: 'doc', tile: 'indigo', value: `${settings.rtty.baud} · ${settings.rtty.shiftHz} Hz` },
      { id: 'macros', title: 'Macros', icon: 'grip', tile: 'indigo', value: `${settings.keyboard.set === 'qso' ? 'QSO' : 'Contest'} · ${settings.keyboard.macros[settings.keyboard.set].length}` },
    ],
    [
      { id: 'radio', title: 'Radio and audio', icon: 'mic', tile: 'orange', value: audio.status === 'running' ? 'Audio on' : 'Audio off' },
      ...(rigShown ? [{ id: 'rig', title: 'Rig control', icon: 'plug' as const, tile: 'orange' as const, value: rigSummary() }] : []),
      { id: 'sdr', title: 'Web SDR', icon: 'headphones', tile: 'teal', value: relay.sdrOn ? relay.receiverName || 'On' : 'Off' },
      { id: 'pskreporter', title: 'PSK Reporter', icon: 'share', tile: 'blue', value: pskReporter.on ? 'On' : 'Off' },
      { id: 'relay', title: 'Relay', icon: 'globe', tile: 'grey', value: relayName(relay.base) },
      { id: 'logging', title: 'Logging', icon: 'book', tile: 'green', value: loggingSummary() },
      { id: 'practice', title: 'Practice band', icon: 'play', tile: 'teal', value: practice.on ? 'On' : 'Off' },
    ],
    [
      { id: 'features', title: 'Optional features', icon: 'addbox', tile: 'grey' },
      { id: 'colours', title: 'Decode colours', icon: 'colours', tile: 'orange', value: presetLabel(presetOf(settings.highlights)) },
      { id: 'appearance', title: 'Appearance', icon: 'sun', tile: 'blue', value: THEMES[settings.theme] },
      { id: 'about', title: 'About', icon: 'info', tile: 'grey', value: __APP_VERSION__ },
    ],
  ]);

  /** The section a path belongs to: Wavelog under Logging, Guide, Version history and Credits under About. */
  const current = $derived.by(() => {
    const sub = route.path[1] ?? 'station';
    if (sub === 'guide' || sub === 'versions' || sub === 'credits') return 'about';
    return groups.flat().some((i) => i.id === sub) ? sub : 'station';
  });

  // Another section starts at the top of the detail column.
  let detail: HTMLDivElement | undefined = $state();
  $effect(() => {
    void route.path.join('/');
    if (detail) detail.scrollTop = 0;
  });
</script>

<section class="split" aria-labelledby={layout.size === 'compact-height' ? 'settings-split-title' : undefined}>
  {#if layout.size === 'compact-height'}
    <BackLink to={href('operate')} label="Operate" title="Settings" id="settings-split-title" />
  {/if}
  <div class="cols">
    <nav class="sections" aria-label="Settings sections">
      {#if layout.size === 'regular'}<p class="large-title" aria-hidden="true">Settings</p>{/if}
      {#each groups as group, i (i)}
        <ul class="group">
          {#each group as item (item.id)}
            <li>
              <a class="it" class:on={current === item.id} href={href('settings', item.id)} aria-current={current === item.id ? 'page' : undefined}>
                <span class="tile {item.tile}" aria-hidden="true"><Icon name={item.icon} size={19} /></span>
                <span class="t">{item.title}</span>
                {#if item.value}<span class="v">{item.value}</span>{/if}
              </a>
            </li>
          {/each}
        </ul>
      {/each}
    </nav>
    <div class="detail" bind:this={detail}>
      {@render children()}
    </div>
  </div>
</section>

<style>
  .split {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: var(--rr-safe-top) 0 0;
    background: var(--rr-bg);
  }

  :global([data-size='regular']) .split {
    padding-top: 0;
  }

  .cols {
    display: flex;
    flex: 1;
    min-height: 0;
  }

  .sections {
    flex: none;
    width: clamp(var(--rr-list-column-narrow), 28vw, var(--rr-sections));
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 0 0 var(--rr-space-6) var(--rr-safe-left);
    box-shadow: inset calc(-1 * var(--rr-hairline)) 0 0 var(--rr-sep-strong);
  }

  :global([data-size='compact-height']) .sections {
    padding-top: var(--rr-space-2);
  }

  .large-title {
    padding-top: var(--rr-space-3);
  }

  .group {
    margin: 0 var(--rr-space-4) var(--rr-space-5);
  }

  .it {
    position: relative;
    display: flex;
    gap: var(--rr-space-3);
    align-items: center;
    min-height: var(--rr-tap);
    padding: 0 var(--rr-space-4) 0 var(--rr-space-3);
    color: var(--rr-label);
    font-size: var(--rr-text-body);
    white-space: nowrap;
  }

  li + li .it::before {
    content: '';
    position: absolute;
    top: 0;
    right: 0;
    left: calc(var(--rr-space-3) + var(--rr-row-icon) + var(--rr-space-3));
    height: var(--rr-hairline);
    background: var(--rr-sep);
    transform: scaleY(0.5);
    transform-origin: 0 0;
  }

  .it.on {
    background: var(--rr-accent-fill);
    color: var(--rr-on-fill);
  }

  .it.on::before,
  li:has(.it.on) + li .it::before {
    display: none;
  }

  .it:focus-visible {
    outline: 2px solid var(--rr-accent);
    outline-offset: -2px;
  }

  @media (hover: hover) {
    .it:not(.on):hover {
      background: var(--rr-fill3);
    }
  }

  .tile {
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: var(--rr-row-icon);
    height: var(--rr-row-icon);
    border-radius: var(--rr-radius-m);
    color: var(--rr-on-fill);
  }

  .tile.blue {
    background: var(--rr-ic-blue);
  }

  .tile.indigo {
    background: var(--rr-ic-indigo);
  }

  .tile.orange {
    background: var(--rr-ic-orange);
  }

  .tile.green {
    background: var(--rr-ic-green);
  }

  .tile.teal {
    background: var(--rr-ic-teal);
  }

  .tile.grey {
    background: var(--rr-ic-grey);
  }

  .t {
    flex: none;
  }

  .v {
    min-width: 0;
    margin-left: auto;
    overflow: hidden;
    color: var(--rr-label2);
    text-overflow: ellipsis;
  }

  .it.on .v {
    color: inherit;
  }

  /* The detail: its own scroll, the content in a column of at most 680 pt. */
  .detail {
    position: relative;
    flex: 1;
    min-width: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding-right: var(--rr-safe-right);
  }

  .detail :global(.screen) {
    min-height: 0;
    padding-top: 0;
  }

  .detail :global(.screen > :not(.bar)) {
    max-width: var(--rr-form);
    margin-inline: auto;
  }
</style>
