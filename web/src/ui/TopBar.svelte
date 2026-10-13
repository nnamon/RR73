<script lang="ts">
  /**
   * Operate's top bar, one 44 pt row under the status bar: band and mode (a tap opens the band
   * sheet) with the dial frequency, the slot ring, the UTC clock, and the buttons that open
   * Spots, the Log and Settings. The audio level is the 2 pt line along its bottom edge. On air,
   * a red edge runs along its top and the ring turns red.
   */
  import Icon from './Icon.svelte';
  import LevelMeter from './LevelMeter.svelte';
  import SlotRing from './SlotRing.svelte';
  import { href } from '../lib/app/router.svelte';
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
    onband,
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
    onband: () => void;
  } = $props();

  const dial = $derived(dialHz === null ? '' : mhz(dialHz).replace(/\sMHz$/, ''));
</script>

<header class="top" class:onair class:crowded={spots}>
  <button class="band" onclick={onband} aria-label="Change band. Now {band} {mode}, {dialHz === null ? '' : mhz(dialHz)} USB.">
    <b class="b">{band}</b>
    <span class="mode">{mode}</span>
    <Icon name="chevdown" size={12} class="chev" />
    <span class="dial">{dial}</span>
  </button>
  <span class="grow"></span>
  <div class="clk" role="timer" aria-label="UTC time and slot progress. {state}">
    <SlotRing {progress} {tone} />
    <span class="utc mono">{utc}</span>
  </div>
  <nav class="icons" aria-label="Screens">
    {#if spots}<a class="bar-button" href={href('spots')} aria-label="Spots"><Icon name="spots" size={24} /></a>{/if}
    <a class="bar-button" href={href('log')} aria-label="Log"><Icon name="log" size={24} /></a>
    <a class="bar-button" href={href('settings')} aria-label="Settings"><Icon name="settings" size={24} /></a>
  </nav>
  <LevelMeter {rmsDb} {live} />
</header>

<style>
  .top {
    position: relative;
    display: flex;
    flex: none;
    align-items: center;
    height: var(--rr-tap);
    padding: 0 var(--rr-safe-right) 0 calc(var(--rr-space-1) + var(--rr-safe-left));
    background: var(--rr-dock);
  }

  .top.onair {
    box-shadow: inset 0 3px 0 var(--rr-tx);
  }

  .band {
    display: flex;
    gap: var(--rr-space-1-5);
    align-items: center;
    min-width: 0;
    height: var(--rr-tap);
    padding: 0 var(--rr-space-1-5);
    border-radius: var(--rr-radius-l);
    white-space: nowrap;
  }

  .b {
    font-size: var(--rr-text-body);
    font-weight: var(--rr-weight-bold);
    letter-spacing: -0.01em;
  }

  .mode {
    padding: var(--rr-space-px) var(--rr-space-1);
    border-radius: var(--rr-radius-s);
    background: var(--rr-accent-soft);
    color: var(--rr-accent);
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

  .clk {
    display: flex;
    flex: none;
    gap: var(--rr-space-1-5);
    align-items: center;
  }

  .utc {
    font-size: var(--rr-text-body);
    font-weight: var(--rr-weight-semibold);
    letter-spacing: 0;
  }

  .icons {
    display: flex;
    flex: none;
    margin-left: var(--rr-space-1);
  }

  /* With Spots shown, a 375 pt screen has no room for the dial; the band sheet shows it. */
  @media (max-width: 389px) {
    .crowded .dial {
      display: none;
    }
  }
</style>
