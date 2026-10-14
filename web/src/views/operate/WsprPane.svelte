<script lang="ts">
  /**
   * WSPR in Operate's frame (views/Operate.svelte): the spots of each 2-minute slot, newest first,
   * and the bottom bar with Beacon, the Tx percentage, ••• and Halt (WsprBar).
   *
   * The middle and the controls are the pane's two parts (data-part), placed by the frame. In
   * regular width the middle gets a header with the sort and Save slot, and the spots line up in
   * columns under their names.
   */
  import Icon from '../../ui/Icon.svelte';
  import { layout } from '../../lib/app/layout.svelte';
  import { SORT_LABELS, SPOT_SORTS } from '../../lib/wspr/spots';
  import { tick } from 'svelte';
  import SaveSlotSheet from '../../ui/SaveSlotSheet.svelte';
  import SpotDetailSheet from '../../ui/SpotDetailSheet.svelte';
  import SpotList from '../../ui/SpotList.svelte';
  import WsprBar from '../../ui/WsprBar.svelte';
  import type { PaneProps } from './panes';
  import { buildWsprList } from '../../lib/wspr/list';
  import type { Spot } from '../../lib/wspr/spots';
  import { clock } from '../../lib/state/now.svelte';
  import { settings, updateSettings } from '../../lib/state/settings.svelte';
  import { audio, band, wsprDecoding } from '../../lib/state/station.svelte';
  import { nextText, wspr } from '../../lib/state/wspr.svelte';

  let { active = true }: PaneProps = $props();

  let saveOpen = $state(false);
  let detailOpen = $state(false);
  let detail = $state<Spot | null>(null);
  let listEl: HTMLDivElement | undefined = $state();

  const live = $derived(audio.status === 'running');
  const regular = $derived(layout.size === 'regular');
  // The list follows the clock only across slot edges and Next's countdown: the 1 s clock is
  // read through these, so a tick rebuilds nothing else.
  const nowMs = $derived(Math.floor(clock.ms / 1000) * 1000);
  const next = $derived(wspr.next ? { slotStartMs: wspr.next.slotStartMs, text: nextText() ?? '', freqHz: settings.wspr.txHz } : null);
  const onAir = $derived(wspr.onAir ? { slotStartMs: wspr.onAir.slotStartMs, text: wspr.onAir.text, freqHz: settings.wspr.txHz } : null);
  const items = $derived(
    buildWsprList({ nowMs, slots: wspr.slots, sent: wspr.sent, sort: settings.wspr.sort, live, decoding: wsprDecoding.startUtcMs, onAir, next }),
  );
  const decoded = $derived(wspr.slots.length > 0 || wspr.sent.length > 0);
  const myCallColour = $derived(settings.highlights.find((h) => h.id === 'myCall' && h.on)?.colour ?? null);
  const sentColour = $derived(settings.highlights.find((h) => h.id === 'sent' && h.on)?.colour ?? null);

  function onselect(s: Spot) {
    wspr.selected = wspr.selected === s.id ? null : s.id;
  }

  function ondetail(s: Spot) {
    detail = s;
    detailOpen = true;
  }

  // New slots go in above: a list scrolled down keeps the rows in view where they are.
  let height = 0;
  $effect.pre(() => {
    void items;
    const el = listEl;
    if (!el) return;
    const top = el.scrollTop;
    height = el.scrollHeight;
    void tick().then(() => {
      if (top > 4 && el.scrollHeight !== height) el.scrollTop = top + (el.scrollHeight - height);
    });
  });

  // A hidden pane loses its scroll position in some engines: keep it across Log and Settings.
  let kept = 0;
  $effect(() => {
    if (!active) {
      kept = listEl?.scrollTop ?? 0;
      return;
    }
    void tick().then(() => {
      if (listEl && kept) listEl.scrollTop = kept;
    });
  });
</script>

<div class="middle" data-part="middle">
  {#if band.decoder.state === 'failed'}
    <div class="decoder-error" role="alert">
      <p class="t">{band.decoder.reason === 'crashed' ? 'Decoding stopped' : 'No spots: the decoder did not load'}</p>
      <p class="s">The waterfall, the beacon and Save slot still work. Reload RR73 to try again.</p>
    </div>
  {/if}
  {#if regular}
    <div class="phd">
      <h2 id="wspr-spots">Spots</h2>
      <div class="chips" role="radiogroup" aria-label="Sort spots by">
        {#each SPOT_SORTS as id (id)}
          <button class="chip" class:on={settings.wspr.sort === id} role="radio" aria-checked={settings.wspr.sort === id} onclick={() => void updateSettings({ wspr: { ...settings.wspr, sort: id } })}>
            <span class="pill">{SORT_LABELS[id]}</span>
          </button>
        {/each}
      </div>
      <button class="save" aria-label="Save slot" onclick={() => (saveOpen = true)}><Icon name="save" size={22} /></button>
    </div>
  {/if}
  <div class="list-wrap">
    <div class="list" bind:this={listEl} role="region" aria-label="Spots, newest slot first" data-testid="spot-list">
      {#if items.length}
        <SpotList {items} nowMs={clock.ms} selectedId={wspr.selected} {myCallColour} {sentColour} {onselect} {ondetail} table={regular} />
      {/if}
      {#if !decoded && band.decoder.state !== 'failed'}
        <div class="empty">
          {#if band.decoder.state === 'loading'}
            <h2>Loading the decoder</h2>
            <p>Spots appear here after each 2-minute slot ends, on even minutes.</p>
          {:else if live}
            <h2>No spots yet</h2>
            <p>Spots appear here after each 2-minute slot ends, on even minutes.</p>
          {:else}
            <h2>No spots yet</h2>
            <p>Spots appear here after each 2-minute slot ends, while audio runs.</p>
          {/if}
        </div>
      {/if}
    </div>
  </div>
</div>
<div class="controls" data-part="controls">
  <WsprBar onsave={() => (saveOpen = true)} variant={regular ? (layout.upright ? 'bottom' : 'panel') : layout.size === 'compact-height' ? 'side' : 'phone'} />
</div>

<SaveSlotSheet bind:open={saveOpen} />
<SpotDetailSheet bind:open={detailOpen} spot={detail} />

<style>
  .list-wrap {
    position: relative;
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: calc(3 * var(--rr-row-decode) + var(--rr-slot-bar));
    background: var(--rr-plain);
  }

  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .decoder-error {
    flex: none;
    margin: var(--rr-space-1) var(--rr-space-2);
    padding: var(--rr-space-1-5) var(--rr-space-3);
    border-radius: var(--rr-radius-l);
    background: var(--rr-warn-soft);
  }

  .decoder-error .t {
    font-size: var(--rr-text-foot);
    font-weight: var(--rr-weight-semibold);
    line-height: var(--rr-leading-foot);
    color: var(--rr-warn);
  }

  .decoder-error .s {
    font-size: var(--rr-text-caption);
    line-height: var(--rr-leading-caption);
  }

  .empty {
    margin-top: var(--rr-space-6);
  }

  /* Regular width: a 44 pt header with the sort and Save slot. */
  .phd {
    display: flex;
    flex: none;
    gap: var(--rr-space-1);
    align-items: center;
    height: var(--rr-tap);
    padding: 0 var(--rr-space-1-5) 0 var(--rr-space-4);
    background: var(--rr-plain);
    box-shadow: inset 0 calc(-1 * var(--rr-hairline)) 0 var(--rr-sep);
    white-space: nowrap;
  }

  .phd h2 {
    margin-right: var(--rr-space-2);
    font-size: var(--rr-text-sub);
    font-weight: var(--rr-weight-semibold);
  }

  .chips {
    display: flex;
    flex: 1;
    min-width: 0;
    align-items: center;
  }

  .chip {
    display: flex;
    flex: none;
    align-items: center;
    min-width: var(--rr-tap);
    height: var(--rr-tap);
    padding: 0 var(--rr-space-half);
  }

  .chip .pill {
    display: flex;
    align-items: center;
    height: var(--rr-chip);
    padding: 0 calc(var(--rr-space-2) + var(--rr-space-half));
    border-radius: var(--rr-radius-pill);
    background: var(--rr-fill-bg);
    font-size: var(--rr-text-sub);
    font-weight: var(--rr-weight-semibold);
  }

  .chip.on .pill {
    background: var(--rr-accent-fill);
    color: var(--rr-on-fill);
  }

  .chip:focus-visible {
    outline: none;
  }

  .chip:focus-visible .pill {
    outline: 2px solid var(--rr-accent);
    outline-offset: 1px;
  }

  .save {
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: var(--rr-tap);
    height: var(--rr-tap);
    color: var(--rr-accent);
  }
</style>
