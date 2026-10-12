<script lang="ts">
  /**
   * Tune: asks first, then plays 1500 Hz for 10 s with a countdown. Halt is the largest control
   * and stops the tone at once; closing the sheet in any way also halts.
   */
  import Sheet from './Sheet.svelte';
  import { mhz } from '../lib/clock/format';
  import { clock } from '../lib/state/now.svelte';
  import { TUNE } from '../lib/audio/output';
  import { halt, startTune, tx } from '../lib/state/station.svelte';

  let { open = $bindable(false), dialHz }: { open: boolean; dialHz: number | null } = $props();

  let started = $state(false);
  const left = $derived(Math.max(0, Math.ceil((tx.endsAtMs - (clock.ms - Date.now() + performance.now())) / 1000)));
  const where = $derived(dialHz === null ? 'the dial frequency' : mhz(dialHz));

  // Close when the tone ends by itself.
  $effect(() => {
    if (started && !tx.tuning) {
      started = false;
      open = false;
    }
  });

  function begin() {
    startTune();
    started = true;
  }

  function stop() {
    halt();
    started = false;
    open = false;
  }
</script>

<Sheet bind:open title={started ? 'Transmitting' : 'Transmit a tune tone?'} onclose={() => (started || tx.tuning) && stop()}>
  {#if !started}
    <p class="body">RR73 plays {TUNE.hz} Hz for {TUNE.seconds} s through the headphone contact. The radio keys by VOX and transmits on {where}.</p>
    <div class="actions">
      <button class="btn tx" onclick={begin}>Start tune</button>
      <button class="btn" onclick={() => (open = false)}>Cancel</button>
    </div>
  {:else}
    <p class="count mono" role="timer" aria-live="off">{left} s</p>
    <p class="body centre">{TUNE.hz} Hz on {where}. Stops by itself at 0 s.</p>
    <button class="btn halt" onclick={stop}>Halt</button>
  {/if}
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

  .actions {
    display: flex;
    flex-direction: column;
    gap: var(--rr-space-2);
    margin-top: var(--rr-space-4);
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
