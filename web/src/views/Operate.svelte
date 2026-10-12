<script lang="ts">
  import AudioBanner from '../ui/AudioBanner.svelte';
  import BandSheet from '../ui/BandSheet.svelte';
  import DecodeList, { type DecodeListItem } from '../ui/DecodeList.svelte';
  import Icon from '../ui/Icon.svelte';
  import LevelMeter from '../ui/LevelMeter.svelte';
  import SaveSlotSheet from '../ui/SaveSlotSheet.svelte';
  import SlotRing from '../ui/SlotRing.svelte';
  import Waterfall from '../ui/Waterfall.svelte';
  import { mhz, utcTime } from '../lib/clock/format';
  import { SLOT_MS, parity, slotProgress } from '../lib/clock/slots';
  import { markDecode, type Mark } from '../lib/decode/marking';
  import { dialHz } from '../lib/radio/bands';
  import { clock } from '../lib/state/now.svelte';
  import { settings } from '../lib/state/settings.svelte';
  import { audio, band, recent, resumeAudio, startAudio, tx } from '../lib/state/station.svelte';

  let bandOpen = $state(false);
  let saveOpen = $state(false);
  let filter = $state<'all' | 'cq' | 'me'>('all');

  const dial = $derived(dialHz(settings.band, settings.mode));
  const live = $derived(audio.status === 'running');
  const progress = $derived(slotProgress(clock.ms, settings.mode));
  const stateText = $derived(
    tx.tuning ? 'Tuning' : live ? 'Receiving' : audio.status === 'starting' ? 'Starting audio' : audio.status === 'stopped' ? 'Audio stopped' : 'Audio off',
  );
  const slotSeconds = $derived(SLOT_MS[settings.mode] / 1000);

  const rows = $derived(
    band.slots.flatMap((s) =>
      s.decodes.map((d, i) => ({ slot: s.startUtcMs, i, row: { decode: d, ...markDecode(d, settings.callsign) } })),
    ),
  );
  const counts = $derived({
    all: rows.length,
    cq: rows.filter((r) => r.row.mark === 'cq').length,
    me: rows.filter((r) => r.row.mark === 'me').length,
  });
  const items = $derived.by(() => {
    const out: DecodeListItem[] = [];
    const want: Mark | null = filter === 'all' ? null : filter;
    for (const s of band.slots) {
      const shown = s.decodes.map((d) => ({ decode: d, ...markDecode(d, settings.callsign) })).filter((r) => !want || r.mark === want);
      if (!shown.length) continue;
      out.push({ kind: 'header', id: `h${s.startUtcMs}`, text: `${utcTime(s.startUtcMs)} UTC · ${s.decodes.length} decodes · decoded in ${(s.ms / 1000).toFixed(2)} s` });
      shown.forEach((row, i) => out.push({ kind: 'row', id: `${s.startUtcMs}-${i}`, row }));
    }
    return out;
  });
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

  <div class="list">
    {#if rows.length}
      <div class="chips" role="radiogroup" aria-label="Show decodes">
        {#each [['all', 'All'], ['cq', 'CQ'], ['me', 'To me']] as const as [id, label] (id)}
          <button class="chip" class:on={filter === id} role="radio" aria-checked={filter === id} onclick={() => (filter = id)}>
            {label} <span class="n">{counts[id]}</span>
          </button>
        {/each}
      </div>
      <DecodeList {items} />
    {:else}
      <div class="empty">
        {#if !band.decoderAvailable}
          <h2>No decoder in this version</h2>
          <p>The waterfall and Save slot work now. Decodes will appear here after each {slotSeconds} s slot once the decoder is added.</p>
        {:else}
          <h2>No decodes yet</h2>
          <p>Decodes appear here after each {slotSeconds} s slot while audio runs.</p>
        {/if}
      </div>
    {/if}
  </div>
</section>

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

  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .chips {
    display: flex;
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
