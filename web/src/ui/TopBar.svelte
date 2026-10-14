<script lang="ts">
  /**
   * Operate's top bar, one 44 pt row under the status bar: band and mode (a tap opens the band
   * sheet) with the dial frequency, the slot ring, the UTC clock, and the buttons that open
   * Spots, the Log and Settings. The audio level is the 2 pt line along its bottom edge. On air,
   * a red edge runs along its top and the ring turns red.
   *
   * In regular width (lib/app/layout.svelte.ts) the bar is 52 pt and stays above every screen:
   * tabs for Operate, Log, Spots and Settings sit in its middle in place of the buttons, and on
   * the other screens, while Tx is on, it says so ("On air · Tx3") and carries Halt.
   */
  import Icon from './Icon.svelte';
  import LevelMeter from './LevelMeter.svelte';
  import SlotRing from './SlotRing.svelte';
  import { href, type Tab } from '../lib/app/router.svelte';
  import { mhz } from '../lib/clock/format';

  let {
    band,
    mode,
    dialHz,
    utc,
    progress,
    tone,
    state,
    onair,
    rmsDb,
    live,
    spots,
    practice = false,
    onband,
    regular = false,
    tab = 'operate',
    air = null,
    kbd = false,
    onhalt,
  }: {
    band: string;
    mode: string;
    dialHz: number | null;
    utc: string;
    progress: number;
    tone: 'rx' | 'tx' | 'idle';
    /** What the station does now, for screen readers: "Receiving", "Transmitting". The ring's colour shows it. */
    state: string;
    onair: boolean;
    rmsDb: number;
    live: boolean;
    /** Shows the Spots button. */
    spots: boolean;
    /** The practice band runs in place of the radio. */
    practice?: boolean;
    onband: () => void;
    /** Regular width: tabs in the middle, and Halt on the other screens while Tx is on. */
    regular?: boolean;
    /** The screen showing, for the tabs. */
    tab?: Tab;
    /** While Tx is on: what the station does ("On air · Tx3", "Tx on") and whether it transmits now. */
    air?: { text: string; live: boolean } | null;
    /** Shows Esc on Halt: a keyboard and a pointer drive the page. */
    kbd?: boolean;
    onhalt?: () => void;
  } = $props();

  const dial = $derived(dialHz === null ? '' : mhz(dialHz).replace(/\sMHz$/, ''));
  const tabs = $derived<{ id: Tab; label: string }[]>([
    { id: 'operate', label: 'Operate' },
    { id: 'log', label: 'Log' },
    ...(spots ? [{ id: 'spots' as const, label: 'Spots' }] : []),
    { id: 'settings', label: 'Settings' },
  ]);
</script>

{#snippet bandButton()}
  <button class="band" onclick={onband} aria-label="Change band. Now {band} {mode}, {dialHz === null ? '' : mhz(dialHz)} USB.">
    <b class="b">{band}</b>
    <span class="mode">{mode}</span>
    <Icon name="chevdown" size={12} class="chev" />
    <span class="dial">{dial}</span>
  </button>
{/snippet}

{#snippet clock()}
  <div class="clk" role="timer" aria-label="UTC time and slot progress. {state}">
    <SlotRing {progress} {tone} />
    <span class="utc">{utc}</span>
  </div>
{/snippet}

{#if regular}
  <header class="top regular" class:onair>
    <div class="side">
      {@render bandButton()}
      {#if practice}<span class="practice">Practice</span>{/if}
    </div>
    <nav class="tabs" aria-label="Screens">
      {#each tabs as t (t.id)}
        <a class="tab" class:on={t.id === tab} href={href(t.id)} aria-current={t.id === tab ? 'page' : undefined}><span class="face">{t.label}</span></a>
      {/each}
    </nav>
    <div class="side end">
      {#if air && tab !== 'operate'}
        <span class="air" class:live={air.live} role="status"><i aria-hidden="true"></i>{air.text}</span>
        <button class="halt" onclick={onhalt}><span class="face">Halt{#if kbd}<kbd aria-hidden="true">esc</kbd>{/if}</span></button>
      {/if}
      {@render clock()}
    </div>
    <LevelMeter {rmsDb} {live} />
  </header>
{:else}
  <header class="top" class:onair>
    {@render bandButton()}
    {#if practice}<span class="practice">Practice</span>{/if}
    <span class="grow"></span>
    {@render clock()}
    <nav class="icons" aria-label="Screens">
      {#if spots}<a class="bar-button" href={href('spots')} aria-label="Spots"><Icon name="spots" size={24} /></a>{/if}
      <a class="bar-button" href={href('log')} aria-label="Log"><Icon name="log" size={24} /></a>
      <a class="bar-button" href={href('settings')} aria-label="Settings"><Icon name="settings" size={24} /></a>
    </nav>
    <LevelMeter {rmsDb} {live} />
  </header>
{/if}

<style>
  .top {
    position: relative;
    display: flex;
    flex: none;
    align-items: center;
    height: var(--rr-tap);
    padding: 0 var(--rr-safe-right) 0 calc(var(--rr-space-1) + var(--rr-safe-left));
    background: var(--rr-dock);
    -webkit-backdrop-filter: var(--rr-material-blur);
    backdrop-filter: var(--rr-material-blur);
  }

  .top.onair {
    box-shadow: inset 0 3px 0 var(--rr-tx);
  }

  /*
   * The band button gives way first when the bar is short of room (Spots on, a 375 pt screen):
   * it wraps, and whatever no longer fits on its one 44 pt line, the dial first, drops out of
   * sight whole. The band sheet shows the dial.
   */
  .band {
    display: flex;
    flex: 0 1 auto;
    flex-wrap: wrap;
    align-content: flex-start;
    column-gap: var(--rr-space-1-5);
    align-items: center;
    min-width: 0;
    height: var(--rr-tap);
    overflow: hidden;
    padding: 0 var(--rr-space-1-5);
    border-radius: var(--rr-radius-l);
    white-space: nowrap;
  }

  /* Holds the first line at the full 44 pt, so the items stay centred when the dial wraps away. */
  .band::before {
    content: '';
    width: 0;
    height: var(--rr-tap);
    margin-right: calc(-1 * var(--rr-space-1-5));
  }

  .b {
    font-size: var(--rr-text-body);
    font-weight: var(--rr-weight-bold);
    letter-spacing: -0.01em;
  }

  .mode {
    padding: var(--rr-space-px) var(--rr-space-1);
    border-radius: var(--rr-radius-s);
    background: var(--rr-fill-bg);
    color: var(--rr-label);
    font-size: var(--rr-text-caption);
    font-weight: var(--rr-weight-bold);
    line-height: var(--rr-leading-caption);
  }

  .band :global(.chev) {
    color: var(--rr-label2);
  }

  .dial {
    font-size: var(--rr-text-sub);
    color: var(--rr-label2);
  }

  .grow {
    flex: 1;
  }

  /* A status badge: the warning tint, so practice never passes for the air. */
  .practice {
    flex: none;
    height: 21px;
    margin-left: var(--rr-space-1);
    padding: 0 var(--rr-space-2);
    border-radius: var(--rr-radius-pill);
    background: var(--rr-warn-soft);
    color: var(--rr-warn);
    font-size: var(--rr-text-caption);
    font-weight: var(--rr-weight-bold);
    line-height: 21px;
    white-space: nowrap;
  }

  .clk {
    display: flex;
    flex: none;
    gap: var(--rr-space-1-5);
    align-items: center;
    margin-left: var(--rr-space-1-5);
  }

  /* SF Pro with tabular digits, so the clock keeps its width. */
  .utc {
    font-size: var(--rr-text-body);
    font-weight: var(--rr-weight-semibold);
    font-variant-numeric: tabular-nums;
    letter-spacing: 0;
  }

  .icons {
    display: flex;
    flex: none;
    margin-left: var(--rr-space-1);
  }

  /*
   * Regular width: band on the left, tabs in the middle, the clock on the right, in three
   * columns so the tabs stay centred and nothing overlaps when the right side grows with Halt.
   */
  .top.regular {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    gap: var(--rr-space-3);
    height: var(--rr-top-regular);
    padding: 0 calc(var(--rr-space-4) + var(--rr-safe-right)) 0 calc(var(--rr-space-2) + var(--rr-safe-left));
    box-shadow: inset 0 calc(-1 * var(--rr-hairline)) 0 var(--rr-sep);
  }

  .top.regular.onair {
    box-shadow:
      inset 0 3px 0 var(--rr-tx),
      inset 0 calc(-1 * var(--rr-hairline)) 0 var(--rr-sep);
  }

  .side {
    display: flex;
    gap: var(--rr-space-2);
    align-items: center;
    min-width: 0;
  }

  .side.end {
    justify-content: flex-end;
  }

  .side .clk {
    margin-left: var(--rr-space-1);
  }

  /* A segmented control of links: 30 pt segments inside 44 pt targets. */
  .tabs {
    display: flex;
    gap: var(--rr-space-half);
    align-items: center;
    padding: 0 var(--rr-space-1);
    border-radius: var(--rr-radius-pill);
    background: var(--rr-fill3);
  }

  .tab {
    display: flex;
    align-items: center;
    height: var(--rr-tap);
    color: var(--rr-label);
  }

  .tab .face {
    display: flex;
    align-items: center;
    height: var(--rr-tab);
    padding: 0 var(--rr-space-4);
    border-radius: var(--rr-radius-pill);
    font-size: var(--rr-text-sub);
    font-weight: var(--rr-weight-semibold);
    white-space: nowrap;
  }

  .tab.on .face {
    background: var(--rr-seg-sel);
    box-shadow:
      0 1px 3px var(--rr-shadow-seg),
      0 0 0 0.5px var(--rr-shadow-seg);
  }

  .tab:focus-visible {
    outline: none;
  }

  .tab:focus-visible .face {
    outline: 2px solid var(--rr-accent);
    outline-offset: 1px;
  }

  @media (hover: hover) {
    .tab:not(.on):hover .face {
      background: var(--rr-fill-bg);
    }
  }

  .air {
    display: flex;
    flex: none;
    gap: var(--rr-space-1-5);
    align-items: center;
    color: var(--rr-accent);
    font-size: var(--rr-text-sub);
    font-weight: var(--rr-weight-semibold);
    white-space: nowrap;
  }

  .air i {
    width: 8px;
    height: 8px;
    border-radius: 4px;
    background: currentcolor;
  }

  .air.live {
    color: var(--rr-tx-text);
  }

  .air.live i {
    background: var(--rr-tx);
  }

  /* Halt: a 32 pt red capsule inside a 44 pt target. */
  .halt {
    display: flex;
    flex: none;
    align-items: center;
    height: var(--rr-tap);
  }

  .halt .face {
    display: flex;
    gap: var(--rr-space-2);
    align-items: center;
    height: var(--rr-halt-small);
    padding: 0 var(--rr-space-4);
    border-radius: var(--rr-radius-pill);
    background: var(--rr-tx-fill);
    color: var(--rr-on-fill);
    font-size: var(--rr-text-sub);
    font-weight: var(--rr-weight-bold);
  }

  .halt:focus-visible {
    outline: none;
  }

  .halt:focus-visible .face {
    outline: 2px solid var(--rr-accent);
    outline-offset: 2px;
  }

  kbd {
    padding: 0 var(--rr-space-1);
    border: var(--rr-hairline) solid currentcolor;
    border-radius: var(--rr-radius-xs);
    font-family: var(--rr-sans);
    font-size: var(--rr-text-tag);
    font-weight: var(--rr-weight-medium);
    line-height: var(--rr-leading-tag);
    opacity: 0.8;
  }
</style>
