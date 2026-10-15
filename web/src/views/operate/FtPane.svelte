<script lang="ts">
  /**
   * FT8 and FT4 in Operate's frame (views/Operate.svelte): the decode list with its filters, and
   * the bottom bar with Tx, CQ, Hunt, ••• and Halt (TxBar).
   *
   * The middle and the controls are the pane's two parts (data-part), which the frame places by
   * size class. In regular width the middle is two panes, as in WSJT-X: Band activity, every
   * decode with the All, CQ and To me filters and a grey bar for each slot we sent in, and Rx
   * frequency, the decodes within 50 Hz of Rx, messages to you and our own Next, Sending and Sent
   * rows. Return calls the selected station and the arrows move the selection (lib/app/shortcuts.ts).
   */
  import { tick } from 'svelte';
  import DecodeList from '../../ui/DecodeList.svelte';
  import Icon from '../../ui/Icon.svelte';
  import SaveSlotSheet from '../../ui/SaveSlotSheet.svelte';
  import TxBar from '../../ui/TxBar.svelte';
  import MessagesSheet from '../../ui/MessagesSheet.svelte';
  import StationDetailSheet from '../../ui/StationDetailSheet.svelte';
  import type { PaneProps } from './panes';
  import { callStation, clearDecodeList, qso, select, setFrequencies, showNotice, tapRow, type Selected } from '../../lib/state/qso.svelte';
  import { layout } from '../../lib/app/layout.svelte';
  import { setListKeys, stepSelection } from '../../lib/app/shortcuts';
  import type { ListItem } from '../../lib/decode/list';
  import { SLOT_MS, isFt } from '../../lib/clock/slots';
  import { TouchFreeze } from '../../lib/decode/freeze';
  import { RX_PANE_HZ, buildList, filterCounts, rowFacts, type Classify, type Filter, type Outgoing } from '../../lib/decode/list';
  import { queueMarks, type QueueMark } from '../../lib/decode/queue';
  import { CHASE_MS, chaseMark, spots } from '../../lib/state/spots.svelte';
  import { applyFocus, focusCall } from '../../lib/decode/focus';
  import { highlightDecode, isNewCategory } from '../../lib/decode/highlight';
  import { log } from '../../lib/log/log.svelte';
  import { buildLogIndex } from '../../lib/log/worked';
  import { orderQueue } from '../../lib/qso/sequencer';
  import { STATUS } from '../../lib/qso/status';
  import { clock } from '../../lib/state/now.svelte';
  import { settings } from '../../lib/state/settings.svelte';
  import { audio, band, recent, type DecodedSlot } from '../../lib/state/station.svelte';
  import { reference } from '../../lib/reference';

  let { active = true, waterfall }: PaneProps = $props();

  /** This pane shows in FT8 and FT4 only. */
  const ftMode = $derived(isFt(settings.mode) ? settings.mode : 'FT8');

  let saveOpen = $state(false);
  let messagesOpen = $state(false);
  let detailOpen = $state(false);
  let detail = $state<Selected | null>(null);

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
  // Hide worked: decodes from stations in the log on this band and mode leave Band activity.
  let hideWorked = $state(false);

  // CQ rows name the caller's country, and decode colours place stations, once the country file
  // has loaded, when the page is idle.
  let countries = $state.raw(reference.loadedCountries());
  if (!reference.loadedCountries()) void reference.warm().then(() => (countries = reference.loadedCountries()));

  const live = $derived(audio.status === 'running');
  const slotSeconds = $derived(SLOT_MS[ftMode] / 1000);

  async function findClear() {
    const hz = (await waterfall?.quietest()) ?? null;
    if (hz === null) {
      showNotice(STATUS.noClear);
      return;
    }
    setFrequencies({ txHz: hz });
    showNotice(STATUS.txSet(hz));
  }

  /** Clear decodes in •••: the list empties at once, even while a touch holds new slots back. */
  function clearList() {
    clearDecodeList();
    shown = band.slots;
    unseen = 0;
    depth = LIST_SLOTS;
  }

  // The list never moves under a finger: while touched, and for 0.5 s after the last touch or
  // scroll, new slots wait. When they go in above a list scrolled down, the rows in view stay put
  // and a pill offers the new ones.
  const freeze = new TouchFreeze();
  let shown = $state<DecodedSlot[]>([]);
  let unseen = $state(0);
  // Band activity keeps an hour of slots. The list draws the newest LIST_SLOTS, and LIST_SLOTS more
  // each time it scrolls near its end, so few rows sit in the page; back at the top, a new slot
  // takes it back to LIST_SLOTS.
  const LIST_SLOTS = 8;
  let depth = $state(LIST_SLOTS);
  const drawn = $derived(shown.slice(0, depth));
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
    const fresh = next.filter((s) => !known.has(s.startUtcMs));
    const el = listEl;
    const top = el?.scrollTop ?? 0;
    const height = el?.scrollHeight ?? 0;
    shown = next;
    if (!el || top <= 4) {
      depth = LIST_SLOTS;
      return;
    }
    // Scrolled down, the slots in view stay drawn below the new ones.
    depth += fresh.length;
    await tick();
    el.scrollTop = top + (el.scrollHeight - height);
    unseen += rowsIn(fresh);
  }

  /** Draws LIST_SLOTS more slots when the list is scrolled within half a screen of its end, or does not fill the screen. */
  function more() {
    const el = listEl;
    // A hidden pane measures 0 and would draw the whole hour.
    if (!el || !el.clientHeight || depth >= shown.length) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - el.clientHeight / 2) depth += LIST_SLOTS;
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
    more();
    void sync();
  }

  function showNewest() {
    unseen = 0;
    listEl?.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Decode colours: the log's calls, grids, entities and zones are indexed once per change of the
  // log or the country file, so each row looks its station up in O(1).
  const logIndex = $derived(buildLogIndex(log.live, countries));
  const classify: Classify = $derived.by(() => {
    const index = logIndex;
    const where = { band: settings.band, mode: ftMode };
    const me = settings.callsign;
    const entries = settings.highlights;
    return (d, sent) => highlightDecode({ text: d.text, sent }, me, index, where, entries);
  });

  // Calling CQ with Repeat CQ on, the callers waiting are tagged on their latest message to us.
  // Kept as text first, so the sequencer's 1 s tick redraws the list only when the queue changes.
  const queueKey = $derived.by(() => {
    const st = qso.st;
    if (!st.config.run || st.phase !== 'cq' || !st.queue.length) return '';
    return JSON.stringify(queueMarks(orderQueue(st.queue, st.config.order), settings.workDupes));
  });
  const queue = $derived<QueueMark[]>(queueKey ? JSON.parse(queueKey) : []);
  // Recomputed when the chase changes or lapses, not on every clock tick.
  const chaseLive = $derived(spots.chase !== null && clock.ms - spots.chase.atMs <= CHASE_MS);
  const chase = $derived(chaseLive ? chaseMark(spots.chase, spots.chase?.atMs ?? 0) : null);
  // Our transmission at the top of the list: planned while Tx is on, then on air. Kept to plain
  // values first, so the sequencer's 1 s tick does not rebuild the list.
  const planSlot = $derived(qso.st.txEnabled && qso.st.next && !qso.onAir ? qso.st.next.slotStartMs : null);
  const planStart = $derived(qso.st.next ? qso.st.next.slotStartMs + qso.st.next.offsetS * 1000 : 0);
  const planText = $derived(qso.st.next?.text ?? '');
  const outgoing: Outgoing = $derived.by(() => {
    const air = qso.onAir;
    const slot = SLOT_MS[ftMode];
    return {
      next: planSlot === null ? null : { slotStartMs: planSlot, startMs: planStart, text: planText, freqHz: settings.txHz },
      onAir: air ? { slotStartMs: Math.floor(air.startMs / slot) * slot, startMs: air.startMs, endMs: air.endMs } : null,
    };
  });
  // While calling a station or in a QSO, rows unrelated to it dim. The focus is a callsign or
  // null, so the sequencer's 1 s tick does not rebuild the list.
  const focus = $derived(focusCall(qso.st));
  const regular = $derived(layout.size === 'regular');
  // New shows what the decode colours call new, so it shows only while one of those categories is
  // on. Regular width: the Rx frequency pane takes the place of the Rx freq filter.
  const anyNew = $derived(settings.highlights.some((e) => e.on && isNewCategory(e.id)));
  const shownFilter = $derived<Filter>((regular && filter === 'rx') || (!anyNew && filter === 'new') ? 'all' : filter);
  // Each decode's row, colours and filter facts, worked out once while the callsign and the colours stay.
  const facts = $derived(rowFacts(settings.callsign, classify));
  const items = $derived(
    applyFocus(buildList(drawn, settings.callsign, shownFilter, settings.rxHz, qso.sent, ftMode, classify, outgoing, regular ? { own: 'bar', hideWorked, facts } : { hideWorked, facts }), focus),
  );
  // Rx frequency has few rows: it takes the whole hour.
  const rxItems = $derived(regular ? applyFocus(buildList(shown, settings.callsign, 'all', settings.rxHz, qso.sent, ftMode, classify, outgoing, { rxPane: true, facts }), focus) : []);
  const counts = $derived(filterCounts(shown, settings.callsign, settings.rxHz, { hideWorked, facts }));
  // A filtered list that leaves the screen part empty draws further back.
  $effect(() => {
    void items;
    void tick().then(more);
  });
  const chips: { id: Filter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'cq', label: 'CQ' },
    { id: 'new', label: 'New' },
    { id: 'me', label: 'To me' },
    { id: 'rx', label: 'Rx freq' },
  ];
  const shownChips = $derived(chips.filter((c) => !(regular && c.id === 'rx') && !(!anyNew && c.id === 'new')));
  const callWord = $derived(layout.pointer === 'mouse' ? 'Double-click' : 'Double-tap');

  // Return calls the selected station; the arrows move the selection through the list's rows.
  const selectable = $derived(items.filter((i): i is RowItem => i.kind === 'row' && i.out?.stage !== 'next'));
  async function reveal() {
    await tick();
    listEl?.querySelector('[aria-pressed=true]')?.scrollIntoView({ block: 'nearest' });
  }
  $effect(() => {
    if (!active) return;
    return setListKeys({
      call() {
        const s = qso.selected;
        if (s) callStation(s.decode, s.slotStartMs);
      },
      move(step) {
        const rows = selectable;
        const id = stepSelection(
          rows.map((r) => r.id),
          qso.selected?.id ?? null,
          step,
        );
        const row = rows.find((r) => r.id === id);
        if (!row) return;
        select(asSelected(row));
        void reveal();
      },
    });
  });

  const FAILED = {
    missing: 'This version was built without the decoder.',
    load: 'The decoder module did not load.',
    worker: 'The decoder could not start on this phone.',
    crashed: 'The decoder stopped.',
  } as const;
</script>

{#snippet failed()}
  {#if band.decoder.state === 'failed'}
    <div class="decoder-error" role="alert">
      <p class="t">{band.decoder.reason === 'crashed' ? 'Decoding stopped' : 'No decodes: the decoder did not load'}</p>
      <p class="s">{FAILED[band.decoder.reason]} The waterfall and Save slot still work. Reload RR73 to try again.</p>
    </div>
  {/if}
{/snippet}

{#snippet chipRow()}
  <div class="chip-row" data-scroll-x>
    <div class="chips" role="radiogroup" aria-label="Show decodes">
      {#each shownChips as c (c.id)}
        <button class="chip" class:on={shownFilter === c.id} role="radio" aria-checked={shownFilter === c.id} onclick={() => (filter = c.id)}>
          <span class="pill">{c.label} <span class="n">{counts[c.id]}</span></span>
        </button>
      {/each}
    </div>
    <button class="chip toggle" class:on={hideWorked} aria-pressed={hideWorked} onclick={() => (hideWorked = !hideWorked)}>
      <span class="pill">{#if hideWorked}<Icon name="check" size={13} />{/if}Hide worked</span>
    </button>
  </div>
  <button class="save" disabled={!recent.slots.length} aria-label="Save slot" onclick={() => (saveOpen = true)}><Icon name="save" size={22} /></button>
{/snippet}

{#snippet decodes(label: string)}
  <div class="list-wrap">
    {#if unseen > 0}
      <button class="newpill" onclick={showNewest}><Icon name="chevdown" size={13} class="up" />{unseen} new {unseen === 1 ? 'decode' : 'decodes'}</button>
    {/if}
    <div class="list" bind:this={listEl} role="region" aria-label={label} data-testid="decode-list" data-keys="list">
      {#if items.length}
        <DecodeList {items} highlights={settings.highlights} nowMs={clock.ms} selectedId={qso.selected?.id ?? null} {countries} lost={qso.lostTo} {queue} {chase} {onselect} {oncall} {ondetail} />
      {:else if band.decoder.state !== 'failed'}
        <div class="empty">
          {#if band.decoder.state === 'loading'}
            <h2>Loading the decoder</h2>
            <p>Decodes appear here after each {slotSeconds} s slot ends.</p>
          {:else if live}
            <h2>No decodes yet</h2>
            <p>Decodes appear here after each {slotSeconds} s slot ends. {callWord} one to call the station.</p>
          {:else}
            <h2>No decodes yet</h2>
            <p>Decodes appear here after each {slotSeconds} s slot ends, while audio runs.</p>
          {/if}
        </div>
      {/if}
    </div>
  </div>
{/snippet}

{#if regular}
  <div class="middle" data-part="middle">
    {@render failed()}
    <div class="panes">
      <section class="pane band" aria-labelledby="band-activity">
        <div class="phd">
          <h2 id="band-activity">Band activity</h2>
          {@render chipRow()}
        </div>
        {@render decodes('Band activity, newest slot first')}
      </section>
      <section class="pane rx" aria-labelledby="rx-frequency">
        <div class="phd">
          <h2 id="rx-frequency">Rx frequency</h2>
          <span class="v">{settings.rxHz} Hz</span>
        </div>
        <div class="list" role="region" aria-label="Rx frequency, newest slot first" data-testid="rx-list" data-keys="list">
          {#if rxItems.length}
            <DecodeList items={rxItems} highlights={settings.highlights} nowMs={clock.ms} selectedId={qso.selected?.id ?? null} {countries} lost={qso.lostTo} {queue} {chase} {onselect} {oncall} {ondetail} />
          {:else if band.decoder.state !== 'failed'}
            <div class="empty">
              <h2>Nothing near Rx yet</h2>
              <p>Decodes within {RX_PANE_HZ} Hz of {settings.rxHz} Hz, messages to you and your own messages appear here.</p>
            </div>
          {/if}
        </div>
      </section>
    </div>
  </div>
  <div class="controls" data-part="controls">
    <TxBar variant={layout.upright ? 'bottom' : 'panel'} onmessages={() => (messagesOpen = true)} onfindclear={() => void findClear()} onclear={clearList} />
  </div>
{:else}
  <div class="middle" data-part="middle">
    {@render failed()}
    <div class="filters">
      {@render chipRow()}
    </div>
    {@render decodes('Decodes, newest slot first')}
  </div>
  <div class="controls" data-part="controls">
    <TxBar variant={layout.size === 'compact-height' ? 'side' : 'phone'} onmessages={() => (messagesOpen = true)} onfindclear={() => void findClear()} onclear={clearList} />
  </div>
{/if}

<svelte:window onpointerup={up} onpointercancel={up} />

<SaveSlotSheet bind:open={saveOpen} />
<MessagesSheet bind:open={messagesOpen} />
<StationDetailSheet bind:open={detailOpen} item={detail} />

<style>
  .filters {
    position: relative;
    z-index: 1;
    display: flex;
    flex: none;
    align-items: center;
    height: var(--rr-filters);
    padding: 0 var(--rr-safe-right) 0 calc(var(--rr-space-2) + var(--rr-safe-left));
    background: var(--rr-plain);
    box-shadow: inset 0 calc(-1 * var(--rr-hairline)) 0 var(--rr-sep);
  }

  /* The chips scroll sideways when they outgrow the row, as the macro row does. */
  .chip-row {
    display: flex;
    flex: 1;
    min-width: 0;
    align-items: center;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    scrollbar-width: none;
  }

  .chip-row::-webkit-scrollbar {
    display: none;
  }

  .chips {
    display: flex;
    flex: none;
    align-items: center;
  }

  .chip.toggle .pill {
    gap: var(--rr-space-1);
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
    padding: 0 calc(var(--rr-space-2) + var(--rr-space-half));
    border-radius: var(--rr-radius-pill);
    background: var(--rr-fill-bg);
    font-size: var(--rr-text-sub);
    font-weight: var(--rr-weight-semibold);
    white-space: nowrap;
  }

  .chip .n {
    margin-left: var(--rr-space-1);
    font-weight: var(--rr-weight-medium);
    color: var(--rr-label2);
  }

  .chip.on .pill {
    background: var(--rr-accent-fill);
    color: var(--rr-on-fill);
  }

  .chip.on .n {
    color: inherit;
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

  /* Regular width: Band activity and Rx frequency side by side, each with a 44 pt header. */
  .panes {
    display: flex;
    flex: 1;
    min-height: 0;
  }

  .pane {
    display: flex;
    flex-direction: column;
    min-width: 0;
    background: var(--rr-plain);
  }

  .pane.band {
    flex: 1.25;
  }

  .pane.rx {
    flex: 1;
    box-shadow: inset var(--rr-hairline) 0 0 var(--rr-sep-strong);
  }

  :global([data-upright]) .pane.band {
    flex: 1;
  }

  .phd {
    position: relative;
    z-index: 1;
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

  .phd .v {
    font-size: var(--rr-text-sub);
    color: var(--rr-label2);
  }

  .phd .save {
    margin-left: auto;
  }

  .pane.rx .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
  }
</style>
