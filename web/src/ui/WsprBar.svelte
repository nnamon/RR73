<script lang="ts">
  /**
   * WSPR's bottom bar. The status line gives the message and the Tx frequency ("9V1NE OJ11 37 ·
   * 1500 Hz") or the latest notice, and on the right "Beacon off", "Stops at 16:05" or the time
   * left on air. Under it: Beacon, the Tx percentage, ••• and Halt.
   *
   * Beacon reads "Beacon" with a grey dot when off, "Tx at :06" in the accent tint while a
   * transmission waits for its slot (as Tx on does in FT8), and "On air" in solid red with a
   * blinking dot. The percentage opens a menu of percentages; a choice applies at once. ••• holds
   * Transmit next slot, Tune for 10 s, Save slot, Sort by and Stop beacon after. Halt ends a
   * transmission and turns the beacon off in one tap.
   *
   * Larger windows place the same parts as TxBar does: `panel` on the right in regular width,
   * `bottom` along the bottom of a window taller than wide, `side` under the waterfall on a phone
   * on its side.
   */
  import { layout } from '../lib/app/layout.svelte';
  import BarButtons, { type BarButton } from './BarButtons.svelte';
  import BarMenu, { type BarMenuItem } from './BarMenu.svelte';
  import { utcHm } from '../lib/clock/format';
  import { TX_PCTS, durationText } from '../lib/wspr/schedule';
  import { SORT_LABELS } from '../lib/wspr/spots';
  import { clock } from '../lib/state/now.svelte';
  import { settings } from '../lib/state/settings.svelte';
  import { halt, startTune, tx } from '../lib/state/station.svelte';
  import { beaconTexts, nextText, setBeacon, setTxPct, stepSort, stepStopAfter, transmitNextSlot, wspr } from '../lib/state/wspr.svelte';

  let { onsave, variant = 'phone' }: { onsave: () => void; variant?: 'phone' | 'panel' | 'bottom' | 'side' } = $props();

  const w = $derived(settings.wspr);
  const onAir = $derived(wspr.onAir);
  const notice = $derived(wspr.notice && clock.ms - wspr.notice.atMs < 20_000 ? wspr.notice : null);
  const tuneLeft = $derived(Math.max(0, Math.ceil((tx.endsAtMs - (clock.ms - Date.now() + performance.now())) / 1000)));

  const line = $derived.by((): { text: string; aside: string } => {
    const msg = beaconTexts();
    const now = clock.ms;
    let aside: string;
    if (tx.tuning) aside = `${tuneLeft} s`;
    else if (onAir) {
      const left = Math.max(0, Math.ceil((onAir.endMs - now) / 1000));
      aside = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} left`;
    } else if (wspr.beacon.on) aside = wspr.beacon.stopsAtMs === null ? 'Beacon on' : `Stops at ${utcHm(wspr.beacon.stopsAtMs)}`;
    else aside = 'Beacon off';
    if (tx.tuning) return { text: `Tune · ${w.txHz} Hz`, aside };
    if (onAir) return { text: `${onAir.text} · ${w.txHz} Hz`, aside };
    if (notice) return { text: notice.text, aside };
    return { text: msg.ok ? `${nextText()} · ${w.txHz} Hz` : msg.error, aside };
  });

  // The floating notices (App.svelte) sit above this bar; 0 while Operate is hidden.
  let barH = $state(0);
  $effect(() => {
    document.documentElement.style.setProperty('--rr-bar-h', `${variant === 'phone' || variant === 'bottom' ? barH : 0}px`);
    return () => document.documentElement.style.removeProperty('--rr-bar-h');
  });

  let open = $state<'pct' | 'more' | null>(null);
  let barEl: HTMLElement;

  function close(focus: boolean) {
    const was = open;
    open = null;
    if (focus && was) barEl?.querySelector<HTMLButtonElement>(`[data-id=${was}]`)?.focus();
  }

  const beaconButton = $derived.by((): Pick<BarButton, 'label' | 'tone' | 'dot'> => {
    if (onAir || tx.tuning) return { label: 'On air', tone: 'air', dot: 'blink' };
    if (wspr.next) return { label: `Tx at :${String(new Date(wspr.next.slotStartMs).getUTCMinutes()).padStart(2, '0')}`, tone: 'soft', dot: 'still' };
    return { label: 'Beacon', tone: wspr.beacon.on ? 'soft' : 'plain', dot: 'still' };
  });

  const buttons: BarButton[] = $derived([
    { id: 'beacon', ...beaconButton, pressed: wspr.beacon.on, onclick: () => setBeacon(!wspr.beacon.on) },
    { id: 'pct', label: `${w.txPct}%`, trail: 'updown', menu: { open: open === 'pct' }, onclick: () => (open = open === 'pct' ? null : 'pct') },
    { id: 'more', label: 'More', icon: 'more', menu: { open: open === 'more' }, onclick: () => (open = open === 'more' ? null : 'more') },
    { id: 'halt', label: 'Halt', tone: 'halt', grow: true, kbd: variant === 'panel' && layout.pointer === 'mouse' ? 'esc' : undefined, onclick: () => halt() },
  ]);

  const pctItems: BarMenuItem[] = $derived(TX_PCTS.map((p) => ({ id: `p${p}`, label: `${p}%`, checked: p === w.txPct, onclick: () => setTxPct(p) })));

  const moreItems: BarMenuItem[] = $derived([
    { id: 'once', label: 'Transmit next slot', onclick: () => transmitNextSlot() },
    { id: 'tune', label: 'Tune for 10 s', onclick: () => startTune(w.txHz) },
    { id: 'save', label: 'Save slot', gap: true, onclick: onsave },
    { id: 'sort', label: 'Sort by', value: SORT_LABELS[w.sort], stay: true, onclick: () => stepSort() },
    { id: 'stop', label: 'Stop beacon after', value: durationText(w.stopAfterMin), stay: true, onclick: () => stepStopAfter() },
  ]);
</script>

<section class="bar {variant}" aria-label="Beacon" bind:this={barEl} bind:offsetHeight={barH}>
  {#if variant === 'panel'}<h2 class="head">Transmit</h2>{/if}
  <div class="status" role="status">
    <span class="msg">{line.text}</span>
    {#if line.aside}<span class="aside">{line.aside}</span>{/if}
  </div>
  {#if variant === 'panel'}<span class="grow"></span>{/if}
  <div class="dock">
    <BarButtons {buttons} {variant} />
    {#if open === 'pct'}
      <BarMenu label="Tx percentage" align="left" items={pctItems} onclose={close} />
    {:else if open === 'more'}
      <BarMenu label="More" items={moreItems} onclose={close} />
    {/if}
  </div>
</section>

<style>
  .bar {
    position: relative;
    z-index: 3;
    flex: none;
    padding: var(--rr-space-1) calc(var(--rr-space-3) + var(--rr-safe-right)) 0 calc(var(--rr-space-3) + var(--rr-safe-left));
    background: var(--rr-dock);
    box-shadow: 0 calc(-1 * var(--rr-hairline)) 0 var(--rr-sep);
  }

  .status {
    display: flex;
    gap: var(--rr-space-2);
    align-items: center;
    height: 20px;
    white-space: nowrap;
  }

  .msg {
    min-width: 0;
    overflow: hidden;
    font-size: var(--rr-text-row);
    font-weight: var(--rr-weight-semibold);
    text-overflow: ellipsis;
  }

  .aside {
    flex: none;
    margin-left: auto;
    font-size: var(--rr-text-caption);
    color: var(--rr-label2);
    font-variant-numeric: tabular-nums;
  }

  .dock {
    display: contents;
  }

  .panel .dock,
  .bottom .dock,
  .side .dock {
    position: relative;
    display: block;
  }

  .panel .status,
  .bottom .status,
  .side .status {
    height: auto;
    min-height: var(--rr-leading-row);
  }

  .panel .msg,
  .bottom .msg,
  .side .msg {
    font-family: var(--rr-mono);
    font-weight: var(--rr-weight-medium);
    line-height: var(--rr-leading-row);
    letter-spacing: 0;
  }

  .panel .aside,
  .bottom .aside {
    font-size: var(--rr-text-foot);
  }

  .head {
    font-size: var(--rr-text-foot);
    font-weight: var(--rr-weight-semibold);
    line-height: var(--rr-leading-foot);
    color: var(--rr-label2);
  }

  .grow {
    flex: 1;
  }

  /* Regular width: the transmit panel on the right, Halt at its foot. */
  .panel {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--rr-space-3);
    min-height: 0;
    padding: var(--rr-space-3) calc(var(--rr-space-4) + var(--rr-safe-right)) calc(var(--rr-space-4) + var(--rr-safe-bottom)) var(--rr-space-4);
    background: var(--rr-bg);
    box-shadow: inset var(--rr-hairline) 0 0 var(--rr-sep-strong);
  }

  .panel .status {
    flex-direction: column;
    gap: var(--rr-space-1);
    align-items: flex-start;
  }

  .panel .msg {
    max-width: 100%;
  }

  .panel .aside {
    margin-left: 0;
  }

  .bottom {
    display: flex;
    flex-direction: column;
    gap: var(--rr-space-2);
    padding: var(--rr-space-2) calc(var(--rr-space-4) + var(--rr-safe-right)) calc(var(--rr-space-3) + var(--rr-safe-bottom)) calc(var(--rr-space-4) + var(--rr-safe-left));
  }

  .side {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--rr-space-2);
    justify-content: flex-end;
    padding: var(--rr-space-2) calc(var(--rr-space-3) + var(--rr-safe-right)) calc(var(--rr-space-2) + var(--rr-safe-bottom)) var(--rr-space-3);
    box-shadow: inset var(--rr-hairline) 0 0 var(--rr-sep-strong);
  }
</style>
