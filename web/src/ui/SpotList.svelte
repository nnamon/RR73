<script lang="ts">
  /**
   * Spots: filter chips, rows of at least 56 px (callsign, references, frequency and mode, age),
   * the status line and the sources' credits. Tapping a row opens it with who spotted it and Go,
   * which hands the spot to `onGo`. Spots `canGo` refuses open without Go.
   */
  import { ageText, emptyText, freqModeText, noteText, referenceText, rowSpoken, spottedText, statusText } from '../lib/spots/copy';
  import type { SpotFeedView } from '../lib/spots/feed.svelte';
  import { defaultFilter, filterSpots, spotKey, type SpotFilter } from '../lib/spots/filter';
  import type { Spot, SpotBadge, SpotClass } from '../lib/spots/types';

  interface Props {
    /** Every spot from the feed. */
    spots: readonly Spot[];
    /** The feed's state, for the empty and status text. */
    feed: SpotFeedView;
    /** The time now, UTC ms, for ages. */
    now: number;
    /** The chips; bind it to keep the choice. */
    filter?: SpotFilter;
    /** Bands the operator uses, as ADIF names such as 20m. Empty hides My bands. */
    myBands?: readonly string[];
    /** True for a spot not worked before. Left out, New only is hidden. */
    isNew?: ((spot: Spot) => boolean) | null;
    /** A tag for a row, such as New park. Without one, QRT spots show QRT. */
    badge?: ((spot: Spot) => SpotBadge | null) | null;
    /** The open row's key (spotKey); bind it to keep it. */
    selected?: string | null;
    /** Go on the open row. */
    onGo: (spot: Spot) => void;
    /** False for a spot Go cannot take, such as CW or a band RR73 has no dial for. Left out, every spot has Go. */
    canGo?: ((spot: Spot) => boolean) | null;
  }

  let { spots, feed, now, filter = $bindable(defaultFilter()), myBands = [], isNew = null, badge = null, selected = $bindable(null), onGo, canGo = null }: Props = $props();

  type ChipId = SpotClass | 'digital' | 'bands' | 'new';

  const ctx = $derived({ myBands, isNew });
  const shown = $derived(filterSpots(spots, filter, ctx));
  const status = $derived(statusText(feed));

  const chips = $derived.by(() => {
    const out: { id: ChipId; label: string; on: boolean }[] = [];
    if (!feed.sources.length) return out;
    if (feed.classes.length > 1) for (const c of feed.classes) out.push({ id: c, label: c, on: filter.classes.includes(c) });
    out.push({ id: 'digital', label: 'FT8 and FT4', on: filter.digitalOnly });
    if (myBands.length) out.push({ id: 'bands', label: 'My bands', on: filter.myBandsOnly });
    if (isNew) out.push({ id: 'new', label: 'New only', on: filter.newOnly });
    return out;
  });

  function toggle(id: ChipId) {
    if (id === 'digital') filter = { ...filter, digitalOnly: !filter.digitalOnly };
    else if (id === 'bands') filter = { ...filter, myBandsOnly: !filter.myBandsOnly };
    else if (id === 'new') filter = { ...filter, newOnly: !filter.newOnly };
    else filter = { ...filter, classes: filter.classes.includes(id) ? filter.classes.filter((c) => c !== id) : [...filter.classes, id] };
  }

  function badgeOf(s: Spot): SpotBadge | null {
    return badge?.(s) ?? (s.qrt ? { text: 'QRT', tone: 'muted' } : null);
  }

  function pick(key: string) {
    selected = selected === key ? null : key;
  }
</script>

<div class="spots">
  {#if chips.length}
    <div class="chips" role="group" aria-label="Show spots">
      {#each chips as c (c.id)}
        <button type="button" class="chip" aria-pressed={c.on} onclick={() => toggle(c.id)}><span class="pill">{c.label}</span></button>
      {/each}
    </div>
  {/if}

  {#if shown.length}
    <ul class="group list" aria-label="Spots, newest first">
      {#each shown as s (spotKey(s))}
        {@const key = spotKey(s)}
        {@const open = selected === key}
        {@const b = badgeOf(s)}
        {@const note = noteText(s)}
        <li class="spot" class:open>
          <button type="button" class="pick" aria-expanded={open} aria-label={rowSpoken(s, b?.text ?? null, now)} onclick={() => pick(key)}>
            <span class="l1">
              <span class="call">{s.activator}</span>
              {#if b}<span class="badge {b.tone}">{b.text}</span>{/if}
              <span class="freq">{freqModeText(s)}</span>
            </span>
            <span class="l2">
              <span class="ref">{referenceText(s)}</span>
              <span class="age">{ageText(s.spottedAt, now)}</span>
            </span>
          </button>
          {#if open}
            <div class="l3">
              <p class="by">
                {spottedText(s)}
                {#if note}<span class="note">{note}</span>{/if}
              </p>
              {#if !canGo || canGo(s)}
                <button type="button" class="btn primary compact go" aria-label="Go to {s.activator}" onclick={() => onGo(s)}>Go</button>
              {/if}
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {:else}
    <div class="group">
      <p class="none">{emptyText(feed, filter, ctx)}</p>
    </div>
  {/if}

  {#if status}<p class="status">{status}</p>{/if}
  {#each feed.credits as credit (credit)}<p class="status credit">{credit}</p>{/each}
</div>

<style>
  .chips {
    display: flex;
    flex-wrap: wrap;
    column-gap: var(--rr-space-2);
    margin-bottom: var(--rr-space-1);
  }

  /* A 44 px target around a pill, styled as the decode list's filters. */
  .chip {
    display: flex;
    align-items: center;
    min-width: var(--rr-tap);
    min-height: var(--rr-tap);
    color: var(--rr-label);
  }

  .pill {
    display: flex;
    align-items: center;
    height: var(--rr-chip);
    padding: 0 calc(var(--rr-space-2) + var(--rr-space-half));
    border-radius: var(--rr-radius-pill);
    background: var(--rr-fill-bg);
    font-size: var(--rr-text-sub);
    font-weight: var(--rr-weight-semibold);
    white-space: nowrap;
  }

  .chip[aria-pressed='true'] .pill {
    background: var(--rr-accent-fill);
    color: var(--rr-on-fill);
  }

  .chip:focus-visible {
    outline: none;
  }

  .chip:focus-visible .pill {
    outline: 2px solid var(--rr-accent);
    outline-offset: 2px;
  }

  .list {
    margin: 0;
    padding: 0;
  }

  .spot {
    position: relative;
  }

  .spot + .spot::before {
    content: '';
    position: absolute;
    top: 0;
    right: 0;
    left: var(--rr-space-4);
    height: var(--rr-hairline);
    background: var(--rr-sep-strong);
    transform: scaleY(0.5);
    transform-origin: 0 0;
  }

  .spot.open {
    background: var(--rr-sel-tint);
    box-shadow: inset var(--rr-mark-bar) 0 0 var(--rr-accent-fill);
  }

  /* 8 + 22 + 4 + 17 + 8 = 59 px, at least 56. */
  .pick {
    display: block;
    width: 100%;
    min-height: calc(var(--rr-tap) + var(--rr-space-3));
    padding: var(--rr-space-2) var(--rr-space-4);
    color: var(--rr-label);
    text-align: left;
  }

  .pick:focus-visible {
    outline-offset: -2px;
  }

  .l1,
  .l2 {
    display: flex;
    align-items: center;
    min-width: 0;
  }

  .l1 {
    gap: var(--rr-space-2);
    line-height: var(--rr-leading-body);
  }

  .call {
    flex: none;
    font-family: var(--rr-mono);
    font-size: var(--rr-text-body);
    font-weight: var(--rr-weight-bold);
    letter-spacing: 0;
  }

  /* The badge gives way on a narrow screen; the callsign and frequency never do. */
  .badge {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    padding: 0 var(--rr-space-1-5);
    border-radius: var(--rr-radius-s);
    font-size: var(--rr-text-caption);
    font-weight: var(--rr-weight-bold);
    line-height: var(--rr-leading-caption);
    letter-spacing: 0;
    white-space: nowrap;
  }

  .badge.teal {
    background: var(--rr-teal);
    color: var(--rr-on-strong);
  }

  .badge.muted {
    background: var(--rr-fill2);
    color: var(--rr-label2);
  }

  /* On the open row's tint the grey text takes the label colour, as on a selected decode row. */
  .spot.open .badge.muted {
    color: var(--rr-label);
  }

  .freq {
    flex: none;
    margin-left: auto;
    font-size: var(--rr-text-sub);
    font-weight: var(--rr-weight-semibold);
    letter-spacing: var(--rr-tracking-tight);
    white-space: nowrap;
  }

  .l2 {
    gap: var(--rr-space-3);
    margin-top: var(--rr-space-1);
    font-size: var(--rr-text-foot);
    line-height: var(--rr-leading-foot);
    color: var(--rr-label2);
  }

  .ref {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .age {
    flex: none;
    white-space: nowrap;
  }

  .l3 {
    display: flex;
    gap: var(--rr-space-3);
    align-items: center;
    justify-content: space-between;
    padding: 0 var(--rr-space-4) var(--rr-space-3);
  }

  .by {
    min-width: 0;
    font-size: var(--rr-text-foot);
    line-height: var(--rr-leading-foot);
    color: var(--rr-label2);
    overflow-wrap: anywhere;
  }

  .note {
    display: block;
    margin-top: var(--rr-space-half);
  }

  .go {
    min-width: calc(var(--rr-tap) + var(--rr-space-8));
  }

  .none {
    padding: var(--rr-space-3) var(--rr-space-4);
    font-size: var(--rr-text-sub);
    line-height: var(--rr-leading-sub);
    color: var(--rr-label2);
  }

  .status {
    padding: var(--rr-space-2) var(--rr-space-4) 0;
    font-size: var(--rr-text-foot);
    line-height: var(--rr-leading-foot);
    color: var(--rr-label2);
  }

  .status.credit {
    padding-top: var(--rr-space-1);
  }
</style>
