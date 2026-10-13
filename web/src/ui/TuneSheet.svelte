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

  let { open = $bindable(false), dialHz }: { open: boolean; dialHz: number | null } = $props();

  let started = $state(false);
  // The frequency of the tone playing, fixed at the start.
  let playingHz = $state(0);
  const left = $derived(Math.max(0, Math.ceil((tx.endsAtMs - (clock.ms - Date.now() + performance.now())) / 1000)));
  const where = $derived(dialHz === null ? 'the dial frequency' : mhz(dialHz));

  // The sheet closes when the tone ends.
  $effect(() => {
    if (open && !started && tx.tuning) {
      playingHz = settings.txHz;
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
  <p class="body centre">{playingHz} Hz on {where}. Stops by itself at 0 s.</p>
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
