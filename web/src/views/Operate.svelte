<script lang="ts">
  import { tick } from 'svelte';
  import ActivationChip from '../ui/ActivationChip.svelte';
  import AudioBanner from '../ui/AudioBanner.svelte';
  import BandSheet from '../ui/BandSheet.svelte';
  import DecodeList from '../ui/DecodeList.svelte';
  import Icon from '../ui/Icon.svelte';
  import SaveSlotSheet from '../ui/SaveSlotSheet.svelte';
  import TopBar from '../ui/TopBar.svelte';
  import TxBar from '../ui/TxBar.svelte';
  import Waterfall from '../ui/Waterfall.svelte';
  import MessagesSheet from '../ui/MessagesSheet.svelte';
  import StationDetailSheet from '../ui/StationDetailSheet.svelte';
  import { callStation, qso, setFrequencies, showNotice, tapRow, type Selected } from '../lib/state/qso.svelte';
  import type { ListItem } from '../lib/decode/list';
  import { utcTime } from '../lib/clock/format';
  import { SLOT_MS, slotProgress } from '../lib/clock/slots';
  import { TouchFreeze } from '../lib/decode/freeze';
  import { buildList, callerItems, filterCounts, type Filter } from '../lib/decode/list';
  import { orderQueue } from '../lib/qso/sequencer';
  import { dialHz } from '../lib/radio/bands';
  import { SIGNAL_HZ } from '../lib/waterfall/pick';
  import { spotsShown } from '../lib/state/features.svelte';
  import { clock } from '../lib/state/now.svelte';
  import { settings } from '../lib/state/settings.svelte';
  import { audio, band, recent, resumeAudio, startAudio, tx, type DecodedSlot } from '../lib/state/station.svelte';

  /** False while another screen is pushed over Operate: the list keeps its place for the return. */
  let { active = true }: { active?: boolean } = $props();

  let bandOpen = $state(false);
  let saveOpen = $state(false);
  let messagesOpen = $state(false);
  let detailOpen = $state(false);
  let detail = $state<Selected | null>(null);
  let wf = $state<ReturnType<typeof Waterfall>>();

  type RowItem = Extract<ListItem, { kind: 'row' }>;
  const asSelected = (i: RowItem): Selected => ({ decode: i.row.decode, slotStartMs: i.slotStartMs, id: i.id });
  // Our own rows say what we sent; selecting one selects the station we sent it to.
  function onselect(i: RowItem) {
    tapRow(asSelected(i));
  }
  function oncall(i: RowItem) {
    callStation(i.row.decode, i.slotStartMs);
  }
  function ondetail(i: RowItem) {
    detail = asSelected(i);
    detailOpen = true;
  }
  let filter = $state<Filter>('all');

  const live = $derived(audio.status === 'running');
  const transmitting = $derived(!!qso.onAir || tx.tuning);
  const stateText = $derived(
    qso.onAir
      ? 'Transmitting'
      : tx.tuning
        ? 'Tuning'
        : live
          ? 'Receiving'
          : audio.status === 'starting'
            ? 'Starting audio'
            : audio.status === 'stopped'
              ? 'Audio stopped'
              : 'Audio off',
  );
  const slotSeconds = $derived(SLOT_MS[settings.mode] / 1000);

  async function findClear() {
    const hz = (await wf?.quietest()) ?? null;
    if (hz === null) {
      showNotice('Finding a clear Tx frequency needs 2 slots of audio.');
      return;
    }
    setFrequencies({ txHz: hz });
    showNotice(`Tx ${hz} Hz: the quietest ${SIGNAL_HZ[settings.mode]} Hz in the last slots.`);
  }

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

  const callers = $derived.by(() => {
    const st = qso.st;
    if (!st.run || (filter !== 'all' && filter !== 'me')) return [];
    return callerItems(shown, settings.callsign, settings.mode, st.partner, orderQueue(st.queue, st.config.order), settings.workDupes);
  });
  const items = $derived([...callers, ...buildList(shown, settings.callsign, filter, settings.rxHz, qso.sent, settings.mode)]);
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
  <TopBar
    band={settings.band}
    mode={settings.mode}
    dialHz={dialHz(settings.band, settings.mode)}
    utc={utcTime(clock.ms)}
    progress={slotProgress(clock.ms, settings.mode)}
    tone={transmitting ? 'tx' : live ? 'rx' : 'idle'}
    state={stateText}
    onair={transmitting}
    rmsDb={audio.rmsDb}
    {live}
    spots={spotsShown()}
    onband={() => (bandOpen = true)}
  />
  <ActivationChip />

  <AudioBanner
    status={audio.status}
    reason={audio.reason}
    error={audio.error}
    stoppedAtUtcMs={audio.stoppedAtUtcMs}
    onstart={() => void startAudio()}
    onresume={() => void resumeAudio()}
  />

  <Waterfall
    bind:this={wf}
    mode={settings.mode}
    rxHz={settings.rxHz}
    txHz={settings.txHz}
    txSlots={tx.slots}
    stoppedAtUtcMs={audio.status === 'stopped' ? audio.stoppedAtUtcMs : null}
    hint={!settings.freqPicked}
    onset={setFrequencies}
  />

  {#if band.decoder.state === 'failed'}
    <div class="decoder-error" role="alert">
      <p class="t">{band.decoder.reason === 'crashed' ? 'Decoding stopped' : 'No decodes: the decoder did not load'}</p>
      <p class="s">{FAILED[band.decoder.reason]} Receive still works: the waterfall and Save slot carry on. Reload RR73 to try again.</p>
    </div>
  {/if}
  <div class="filters">
    <div class="chips" role="radiogroup" aria-label="Show decodes">
      {#each chips as c (c.id)}
        <button class="chip" class:on={filter === c.id} role="radio" aria-checked={filter === c.id} onclick={() => (filter = c.id)}>
          <span class="pill">{c.label} <span class="n">{counts[c.id]}</span></span>
        </button>
      {/each}
    </div>
    <button class="save" disabled={!recent.slots.length} aria-label="Save slot" onclick={() => (saveOpen = true)}><Icon name="save" size={22} /></button>
  </div>
  <div class="list-wrap">
    {#if unseen > 0}
      <button class="newpill" onclick={showNewest}><Icon name="chevdown" size={13} class="up" />{unseen} new {unseen === 1 ? 'decode' : 'decodes'}</button>
    {/if}
    <div class="list" bind:this={listEl} role="region" aria-label="Decodes, newest slot first" data-testid="decode-list">
      {#if items.length}
        <DecodeList {items} selectedId={qso.selected?.id ?? null} {onselect} {oncall} {ondetail} />
      {:else if band.decoder.state !== 'failed'}
        <div class="empty">
          {#if band.decoder.state === 'loading'}
            <h2>Loading the decoder</h2>
            <p>Decodes appear here after each {slotSeconds} s slot ends.</p>
          {:else if live}
            <h2>No decodes yet</h2>
            <p>Decodes appear here after each {slotSeconds} s slot ends. Double-tap one to call the station.</p>
          {:else}
            <h2>No decodes yet</h2>
            <p>Decodes appear here after each {slotSeconds} s slot ends, while audio runs.</p>
          {/if}
        </div>
      {/if}
    </div>
  </div>
  <TxBar onmessages={() => (messagesOpen = true)} onfindclear={() => void findClear()} />
</section>

<svelte:window onpointerup={up} onpointercancel={up} />

<BandSheet bind:open={bandOpen} />
<SaveSlotSheet bind:open={saveOpen} />
<MessagesSheet bind:open={messagesOpen} />
<StationDetailSheet bind:open={detailOpen} item={detail} />

<style>
  /* On short screens with a banner, Operate scrolls; the bottom bar stays at the bottom, so Halt
     never leaves the screen. */
  .operate {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding-top: var(--rr-safe-top);
    background: var(--rr-dock);
  }

  .filters {
    position: relative;
    z-index: 1;
    display: flex;
    flex: none;
    align-items: center;
    height: var(--rr-filters);
    padding: 0 var(--rr-safe-right) 0 calc(var(--rr-space-2) + var(--rr-safe-left));
    background: var(--rr-bg);
    box-shadow: inset 0 calc(-1 * var(--rr-hairline)) 0 var(--rr-sep);
  }

  .chips {
    display: flex;
    flex: 1;
    min-width: 0;
    align-items: center;
  }

  /* 28 pt chips inside 44 pt targets that reach over the edges of the 36 pt row. */
  .chip {
    display: flex;
    flex: none;
    align-items: center;
    min-width: var(--rr-tap);
    height: var(--rr-tap);
    margin: calc((var(--rr-filters) - var(--rr-tap)) / 2) 0;
    padding: 0 var(--rr-space-half);
  }

  .chip .pill {
    display: flex;
    align-items: center;
    height: var(--rr-chip);
    padding: 0 var(--rr-space-3);
    border-radius: 14px;
    background: var(--rr-fill-bg);
    font-size: var(--rr-text-row);
    font-weight: var(--rr-weight-semibold);
    white-space: nowrap;
  }

  .chip .n {
    margin-left: var(--rr-space-1);
    font-weight: var(--rr-weight-medium);
    color: var(--rr-label2);
  }

  .chip.on .pill {
    background: var(--rr-label);
    color: var(--rr-on-strong);
  }

  .chip.on .n {
    color: inherit;
    opacity: 0.75;
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
    margin: calc((var(--rr-filters) - var(--rr-tap)) / 2) 0;
    color: var(--rr-accent);
  }

  .save:disabled {
    opacity: 0.35;
  }

  .list-wrap {
    position: relative;
    background: var(--rr-plain);
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: calc(3 * var(--rr-row-decode) + var(--rr-slot-bar));
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

  .newpill {
    position: absolute;
    top: var(--rr-space-1);
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

  .empty {
    margin-top: var(--rr-space-6);
  }
</style>
