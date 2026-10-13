<script lang="ts">
  /**
   * Settings › Practice band: the switch that turns practice on (and starts the band at once),
   * the crowded band, Play Tx audio, and Clear practice log with Undo.
   */
  import BackLink from '../ui/BackLink.svelte';
  import { href } from '../lib/app/router.svelte';
  import { log } from '../lib/log/log.svelte';
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
          <span class="row-sub">Simulated stations through the decoder. No radio or microphone needed.</span>
        </span>
        <input type="checkbox" role="switch" class="switch" checked={practice.on} onchange={(e) => void setPracticeOn(e.currentTarget.checked)} />
      </label>
      <label class="row">
        <span class="row-main">
          <span class="row-title">Crowded band</span>
          <span class="row-sub">{practice.crowded ? '25 to 40 stations a slot' : '8 to 15 stations a slot'}</span>
        </span>
        <input type="checkbox" role="switch" class="switch" checked={practice.crowded} onchange={(e) => void setCrowded(e.currentTarget.checked)} />
      </label>
      <label class="row">
        <span class="row-main">
          <span class="row-title">Play Tx audio</span>
          <span class="row-sub">{practice.playTx ? 'Transmissions and Tune play through the headphone contact' : 'Transmissions and Tune run silently'}</span>
        </span>
        <input type="checkbox" role="switch" class="switch" checked={practice.playTx} onchange={(e) => void setPlayTx(e.currentTarget.checked)} />
      </label>
    </div>
    <p class="section-foot">
      While practice is on, Operate shows Practice, QSOs go to the practice log, and Send to Wavelog goes to a stand-in on this phone. RR73 sends nothing over the network. Your log
      returns when practice is off. Choose a scenario from ••• in Operate.
    </p>
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
    <p class="section-foot">Clears practice QSOs only. Undo shows for 10 s.</p>
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
