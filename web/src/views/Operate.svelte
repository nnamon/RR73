<script lang="ts">
  import { tick } from 'svelte';
  import ActivationChip from '../ui/ActivationChip.svelte';
  import AudioBanner from '../ui/AudioBanner.svelte';
  import BandSheet from '../ui/BandSheet.svelte';
  import DecodeList from '../ui/DecodeList.svelte';
  import Icon from '../ui/Icon.svelte';
  import LevelMeter from '../ui/LevelMeter.svelte';
  import SaveSlotSheet from '../ui/SaveSlotSheet.svelte';
  import SlotRing from '../ui/SlotRing.svelte';
  import Waterfall from '../ui/Waterfall.svelte';
  import { mhz, utcTime } from '../lib/clock/format';
  import { SLOT_MS, parity, slotProgress } from '../lib/clock/slots';
  import { TouchFreeze } from '../lib/decode/freeze';
  import { buildList, filterCounts, type Filter } from '../lib/decode/list';
  import { dialHz } from '../lib/radio/bands';
  import { clock } from '../lib/state/now.svelte';
  import { settings } from '../lib/state/settings.svelte';
  import { audio, band, recent, resumeAudio, startAudio, tx, type DecodedSlot } from '../lib/state/station.svelte';

  let bandOpen = $state(false);
  let saveOpen = $state(false);
  let filter = $state<Filter>('all');

  const dial = $derived(dialHz(settings.band, settings.mode));
  const live = $derived(audio.status === 'running');
  const progress = $derived(slotProgress(clock.ms, settings.mode));
  const stateText = $derived(
    tx.tuning ? 'Tuning' : live ? 'Receiving' : audio.status === 'starting' ? 'Starting audio' : audio.status === 'stopped' ? 'Audio stopped' : 'Audio off',
  );
  const slotSeconds = $derived(SLOT_MS[settings.mode] / 1000);

  // The list never moves under a finger: while touched, and for 0.5 s after the last touch or
  // scroll, new slots wait. When they go in above a list scrolled down, the rows in view stay put
  // and a pill offers the new ones.
  const freeze = new TouchFreeze();
  let shown = $state<DecodedSlot[]>([]);
  let unseen = $state(0);
  let touching = false;
  let listEl: HTMLDivElement | undefined = $state();
  let timer: ReturnType<typeof setTimeout> | undefined;

  function rowsIn(slots: DecodedSlot[]): number {
    return slots.reduce((n, s) => n + s.decodes.length, 0);
  }

  async function sync() {
    clearTimeout(timer);
    const now = performance.now();
    if (freeze.frozen(now)) {
      const wait = freeze.wait(now);
      if (wait !== Number.POSITIVE_INFINITY) timer = setTimeout(sync, wait + 20);
      return;
    }
    const next = band.slots;
    if (next === shown) return;
    const known = new Set(shown.map((s) => s.startUtcMs));
    const added = rowsIn(next.filter((s) => !known.has(s.startUtcMs)));
    const el = listEl;
    const top = el?.scrollTop ?? 0;
    const height = el?.scrollHeight ?? 0;
    shown = next;
    if (!el || top <= 4) return;
    await tick();
    el.scrollTop = top + (el.scrollHeight - height);
    unseen += added;
  }

  $effect(() => {
    void band.slots;
    void sync();
  });

  // Touch and scroll on the list only freeze it; they are not interactions of their own.
  $effect(() => {
    const el = listEl;
    if (!el) return;
    el.addEventListener('pointerdown', down, { passive: true });
    el.addEventListener('scroll', scrolled, { passive: true });
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('scroll', scrolled);
    };
  });

  function down() {
    touching = true;
    freeze.down(performance.now());
  }

  function up() {
    if (!touching) return;
    touching = false;
    freeze.up(performance.now());
    void sync();
  }

  function scrolled() {
    freeze.activity(performance.now());
    if ((listEl?.scrollTop ?? 0) <= 4) unseen = 0;
    void sync();
  }

  function showNewest() {
    unseen = 0;
    listEl?.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const items = $derived(buildList(shown, settings.callsign, filter, settings.rxHz));
  const counts = $derived(filterCounts(shown, settings.callsign, settings.rxHz));
  const chips: { id: Filter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'cq', label: 'CQ' },
    { id: 'me', label: 'To me' },
    { id: 'rx', label: 'Rx freq' },
  ];

  const FAILED = {
    missing: 'This version was built without the decoder.',
    load: 'The decoder module did not load.',
    worker: 'The decoder could not start on this phone.',
    crashed: 'The decoder stopped.',
  } as const;
</script>

<section class="operate" aria-labelledby="operate-title">
  <h1 id="operate-title" class="visually-hidden">Operate</h1>
  <header class="head">
    <div class="band-col">
      <button class="band" onclick={() => (bandOpen = true)} aria-label="Change band. Now {settings.band} {settings.mode}, {dial === null ? '' : mhz(dial)} USB.">
        <span class="l1">
          <span class="band-m">{settings.band}</span>
          <span class="mode">{settings.mode}</span>
          <Icon name="chevdown" size={14} class="chev" />
        </span>
        <span class="l2">{dial === null ? '' : mhz(dial)} · USB</span>
      </button>
      <LevelMeter rmsDb={audio.rmsDb} {live} />
    </div>
    <div class="clk" role="timer" aria-label="UTC time and slot progress">
      <SlotRing progress={progress} tone={tx.tuning ? 'tx' : live ? 'rx' : 'idle'} />
      <div>
        <p class="utc mono">{utcTime(clock.ms)}</p>
        <p class="state" class:alert={tx.tuning || audio.status === 'stopped'}>{stateText}</p>
      </div>
    </div>
  </header>
  <ActivationChip />

  <AudioBanner
    status={audio.status}
    reason={audio.reason}
    error={audio.error}
    stoppedAtUtcMs={audio.stoppedAtUtcMs}
    onstart={() => void startAudio()}
    onresume={() => void resumeAudio()}
  />

  <Waterfall mode={settings.mode} rxHz={settings.rxHz} txHz={settings.txHz} stoppedAtUtcMs={audio.status === 'stopped' ? audio.stoppedAtUtcMs : null} />

  <div class="tools">
    <p class="info">
      {#if recent.slots.length}
        {recent.slots.length} {recent.slots.length === 1 ? 'slot' : 'slots'} kept · {parity(clock.ms, settings.mode) === 'even' ? 'Even' : 'Odd'} slot now
      {:else if live}
        First slot kept at the next {slotSeconds} s boundary
      {:else}
        Slots are kept while audio runs
      {/if}
    </p>
    <button class="btn tint compact" disabled={!recent.slots.length} onclick={() => (saveOpen = true)}>Save slot</button>
  </div>

  <div class="list-wrap">
    {#if band.decoder.state === 'failed'}
      <div class="decoder-error" role="alert">
        <p class="t">{band.decoder.reason === 'crashed' ? 'Decoding stopped' : 'No decodes: the decoder did not load'}</p>
        <p class="s">{FAILED[band.decoder.reason]} Receive still works: the waterfall and Save slot carry on. Reload RR73 to try again.</p>
      </div>
    {/if}
    {#if shown.length}
      <div class="chips" role="radiogroup" aria-label="Show decodes">
        {#each chips as c (c.id)}
          <button class="chip" class:on={filter === c.id} role="radio" aria-checked={filter === c.id} onclick={() => (filter = c.id)}>
            {c.label} <span class="n">{counts[c.id]}</span>
          </button>
        {/each}
      </div>
    {/if}
    {#if unseen > 0}
      <button class="newpill" onclick={showNewest}><Icon name="chevdown" size={13} class="up" />{unseen} new {unseen === 1 ? 'decode' : 'decodes'}</button>
    {/if}
    <div class="list" bind:this={listEl} role="region" aria-label="Decodes, newest slot first" data-testid="decode-list">
      {#if shown.length}
        <DecodeList {items} />
      {:else if band.decoder.state !== 'failed'}
        <div class="empty">
          {#if band.decoder.state === 'loading'}
            <h2>Loading the decoder</h2>
            <p>Decodes appear here after each {slotSeconds} s slot ends.</p>
          {:else}
            <h2>No decodes yet</h2>
            <p>Decodes appear here after each {slotSeconds} s slot ends, while audio runs.</p>
          {/if}
        </div>
      {/if}
    </div>
  </div>
</section>

<svelte:window onpointerup={up} onpointercancel={up} />

<BandSheet bind:open={bandOpen} />
<SaveSlotSheet bind:open={saveOpen} />

<style>
  .operate {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding-top: var(--rr-safe-top);
    background: var(--rr-plain);
  }

  .head {
    display: flex;
    flex: none;
    align-items: center;
    justify-content: space-between;
    gap: var(--rr-space-2);
    padding: var(--rr-space-1) calc(var(--rr-space-4) + var(--rr-safe-right)) var(--rr-space-1) calc(var(--rr-space-4) + var(--rr-safe-left));
  }

  .band-col {
    min-width: 0;
  }

  .band {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    min-height: var(--rr-tap);
    text-align: left;
  }

  .l1 {
    display: flex;
    align-items: center;
    height: var(--rr-leading-title);
  }

  .band-m {
    font-size: var(--rr-text-title);
    font-weight: var(--rr-weight-bold);
    line-height: var(--rr-leading-title);
    letter-spacing: -0.012em;
  }

  .mode {
    height: 19px;
    margin-left: var(--rr-space-2);
    padding: 0 var(--rr-space-1);
    border-radius: var(--rr-radius-s);
    background: var(--rr-accent-soft);
    color: var(--rr-accent);
    font-size: var(--rr-text-caption);
    font-weight: var(--rr-weight-bold);
    line-height: 19px;
    letter-spacing: 0.01em;
  }

  .band :global(.chev) {
    margin-left: var(--rr-space-1);
    color: var(--rr-label2);
  }

  .l2 {
    margin-top: var(--rr-space-px);
    font-size: var(--rr-text-foot);
    line-height: var(--rr-leading-foot);
    color: var(--rr-label2);
    white-space: nowrap;
  }

  .clk {
    display: flex;
    flex: none;
    gap: var(--rr-space-2);
    align-items: center;
  }

  .utc {
    font-size: var(--rr-text-clock);
    font-weight: var(--rr-weight-semibold);
    line-height: 23px;
    letter-spacing: -0.01em;
  }

  .state {
    font-size: var(--rr-text-foot);
    line-height: var(--rr-leading-foot);
    color: var(--rr-label2);
    white-space: nowrap;
  }

  .state.alert {
    color: var(--rr-tx-text);
    font-weight: var(--rr-weight-semibold);
  }

  .tools {
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--rr-space-3);
    padding: var(--rr-space-1) calc(var(--rr-space-4) + var(--rr-safe-right)) var(--rr-space-1) calc(var(--rr-space-4) + var(--rr-safe-left));
    border-bottom: var(--rr-hairline) solid var(--rr-sep);
  }

  .info {
    flex: 1;
    min-width: 0;
    font-size: var(--rr-text-foot);
    line-height: var(--rr-leading-foot);
    color: var(--rr-label2);
  }

  .list-wrap {
    position: relative;
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
  }

  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .decoder-error {
    flex: none;
    margin: var(--rr-space-2) var(--rr-space-4) 0;
    padding: var(--rr-space-2) var(--rr-space-3);
    border-radius: var(--rr-radius-xl);
    background: var(--rr-warn-soft);
  }

  .decoder-error .t {
    font-size: var(--rr-text-sub);
    font-weight: var(--rr-weight-semibold);
    line-height: var(--rr-leading-sub);
    color: var(--rr-warn);
  }

  .decoder-error .s {
    font-size: var(--rr-text-foot);
    line-height: var(--rr-leading-foot);
  }

  .newpill {
    position: absolute;
    top: calc(var(--rr-tap) + var(--rr-space-1));
    left: 50%;
    z-index: 2;
    display: inline-flex;
    gap: var(--rr-space-1);
    align-items: center;
    min-height: var(--rr-tap);
    padding: 0 var(--rr-space-4);
    border-radius: var(--rr-radius-pill);
    background: var(--rr-accent-fill);
    color: var(--rr-on-fill);
    font-size: var(--rr-text-foot);
    font-weight: var(--rr-weight-semibold);
    transform: translateX(-50%);
  }

  .newpill :global(.up) {
    transform: rotate(180deg);
  }

  .chips {
    display: flex;
    flex: none;
    gap: var(--rr-space-2);
    align-items: center;
    height: var(--rr-tap);
    padding: 0 var(--rr-space-4);
    overflow-x: auto;
  }

  .chip {
    display: flex;
    flex: none;
    align-items: center;
    height: var(--rr-chip);
    padding: 0 var(--rr-space-3);
    border-radius: var(--rr-radius-m);
    background: var(--rr-fill);
    font-size: var(--rr-text-row);
    font-weight: var(--rr-weight-semibold);
    letter-spacing: -0.01em;
  }

  .chip .n {
    margin-left: var(--rr-space-1);
    font-weight: var(--rr-weight-medium);
    color: var(--rr-label2);
  }

  .chip.on {
    background: var(--rr-label);
    color: var(--rr-on-strong);
  }

  .chip.on .n {
    color: inherit;
  }

  .empty {
    margin-top: var(--rr-space-8);
  }
</style>
