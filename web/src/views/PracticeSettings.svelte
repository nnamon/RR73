<script lang="ts">
  /**
   * Settings › Practice band: the switch that turns practice on (and starts the band at once),
   * the crowded band, Play Tx audio, and Clear practice log with Undo. The practice band never keys
   * the radio by CAT (lib/state/radio.svelte.ts), and the footer says so where rig control exists.
   * Play Tx audio sends the transmissions to the Tx output, where a radio with VOX on transmits them.
   */
  import BackLink from '../ui/BackLink.svelte';
  import { href } from '../lib/app/router.svelte';
  import { log } from '../lib/log/log.svelte';
  import { catSupported } from '../lib/state/cat.svelte';
  import { practice } from '../lib/state/practice.svelte';
  import { cleared, clearPracticeLog, practiceQsoCount, setCrowded, setPlayTx, setPracticeOn } from '../lib/practice/runtime.svelte';

  let count = $state<number | null>(null);
  let clearing = $state(false);

  // The count follows the practice log while it is loaded, and is read from storage otherwise.
  $effect(() => {
    void practice.on;
    void log.live.length;
    void cleared.version;
    void log.notice;
    let current = true;
    void practiceQsoCount().then((n) => {
      if (current) count = n;
    });
    return () => {
      current = false;
    };
  });

  async function clear() {
    if (clearing) return;
    clearing = true;
    try {
      await clearPracticeLog();
      count = 0;
    } finally {
      clearing = false;
    }
  }

  const countText = $derived(count === null ? '' : count === 0 ? 'No practice QSOs' : `${count} practice ${count === 1 ? 'QSO' : 'QSOs'}`);
</script>

<section class="screen sub" aria-labelledby="practice-title">
  <BackLink to={href('settings')} label="Settings" title="Practice band" id="practice-title" />

  <div class="section">
    <div class="group">
      <label class="row">
        <span class="row-main">
          <span class="row-title">Practice band</span>
          <span class="row-sub">Simulated stations. No radio needed.</span>
        </span>
        <input type="checkbox" role="switch" class="switch" checked={practice.on} onchange={(e) => void setPracticeOn(e.currentTarget.checked)} />
      </label>
      <label class="row">
        <span class="row-main">
          <span class="row-title">Crowded band</span>
        </span>
        <input type="checkbox" role="switch" class="switch" checked={practice.crowded} onchange={(e) => void setCrowded(e.currentTarget.checked)} />
      </label>
      <label class="row">
        <span class="row-main">
          <span class="row-title">Play Tx audio</span>
          <span class="row-sub">Can key a radio by VOX</span>
        </span>
        <input type="checkbox" role="switch" class="switch" checked={practice.playTx} onchange={(e) => void setPlayTx(e.currentTarget.checked)} />
      </label>
    </div>
    {#if practice.playTx}<p class="section-foot" data-testid="practice-vox">Practice transmissions play through the Tx output. A radio there with VOX on transmits them.</p>{/if}
    {#if catSupported()}<p class="section-foot" data-testid="practice-cat">The practice band never keys the radio by CAT.</p>{/if}
  </div>

  <div class="section">
    <h2 class="section-head">Practice log</h2>
    <div class="group">
      <button class="row clear" disabled={clearing || !count} onclick={() => void clear()}>
        <span class="row-main">
          <span class="row-title danger">Clear practice log</span>
          <span class="row-sub" aria-live="polite">{countText}</span>
        </span>
      </button>
    </div>
  </div>
</section>

<style>
  .clear {
    width: 100%;
    text-align: left;
  }

  .danger {
    color: var(--rr-tx-text);
  }

  .clear:disabled .danger {
    opacity: 0.4;
  }
</style>
