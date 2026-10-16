<script lang="ts">
  /**
   * Tune from Radio and audio: the tap that opens the sheet starts the tone at the Tx frequency
   * (startTune, inside the tap for iOS); the sheet counts down its 10 s. Halt is the largest control and stops the tone at once; closing the sheet in any
   * way also halts.
   */
  import Sheet from './Sheet.svelte';
  import { mhz } from '../lib/clock/format';
  import { clock } from '../lib/state/now.svelte';
  import { halt, tx } from '../lib/state/station.svelte';
  import { settings } from '../lib/state/settings.svelte';

  /** `dialHz`: the radio's dial while rig control reads one, else the band's dial in RR73. */
  let { open = $bindable(false), dialHz }: { open: boolean; dialHz: number | null } = $props();

  let started = $state(false);
  // The frequency of the tone playing and the dial under it, fixed at the start: with Keep Tx audio
  // centred the radio's dial moves for the tone, and the RF stays where these two put it.
  let playingHz = $state(0);
  let playingDialHz = $state<number | null>(null);
  const left = $derived(Math.max(0, Math.ceil((tx.endsAtMs - (clock.ms - Date.now() + performance.now())) / 1000)));
  const shownDialHz = $derived(started ? playingDialHz : dialHz);
  const where = $derived(shownDialHz === null ? 'the dial frequency' : mhz(shownDialHz));

  // The sheet closes when the tone ends.
  $effect(() => {
    if (open && !started && tx.tuning) {
      playingHz = settings.txHz;
      playingDialHz = dialHz;
      started = true;
    } else if (started && !tx.tuning) {
      started = false;
      open = false;
    }
  });

  function stop() {
    halt();
    started = false;
    open = false;
  }
</script>

<Sheet bind:open title="Tuning" onclose={() => (started || tx.tuning) && stop()}>
  <p class="count mono" role="timer" aria-live="off">{left} s</p>
  <p class="body centre">{playingHz} Hz on {where}</p>
  <button class="btn halt" onclick={stop}>Halt</button>
</Sheet>

<style>
  .body {
    margin-top: var(--rr-space-3);
    font-size: var(--rr-text-sub);
    line-height: var(--rr-leading-sub);
  }

  .centre {
    text-align: center;
    color: var(--rr-label2);
  }

  .count {
    margin-top: var(--rr-space-4);
    font-size: var(--rr-text-countdown);
    font-weight: var(--rr-weight-semibold);
    line-height: var(--rr-leading-countdown);
    color: var(--rr-tx-text);
    text-align: center;
  }

  .halt {
    width: 100%;
    min-height: var(--rr-button-halt);
    margin-top: var(--rr-space-6);
    font-size: var(--rr-text-title);
  }
</style>
