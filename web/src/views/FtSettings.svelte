<script lang="ts">
  /** Settings › FT8 and FT4: the sequencer's settings (ADR 0006). */
  import BackLink from '../ui/BackLink.svelte';
  import { href } from '../lib/app/router.svelte';
  import { normaliseMinutes, settings, updateSettings } from '../lib/state/settings.svelte';

  let watchdogMin = $state(String(settings.watchdogMin));
  $effect(() => {
    watchdogMin = String(settings.watchdogMin);
  });

  /** Any positive number of minutes; anything else puts back the stored value. */
  function saveWatchdog() {
    const m = normaliseMinutes(Number(watchdogMin.replace(',', '.')));
    if (m === null) watchdogMin = String(settings.watchdogMin);
    else void updateSettings({ watchdogMin: m });
  }
</script>

<section class="screen sub" aria-labelledby="ft8-title">
  <BackLink to={href('settings')} label="Settings" title="FT8 and FT4" id="ft8-title" />

  <div class="section">
    <div class="group">
      <div class="row">
        <span class="row-main"><span class="row-title" id="ack">Confirm with</span></span>
        <span class="seg ack" role="radiogroup" aria-labelledby="ack">
          {#each ['RR73', 'RRR'] as const as a (a)}
            <label class="seg-i" class:on={settings.ack === a}>
              <input class="visually-hidden" type="radio" name="ack" value={a} checked={settings.ack === a} onchange={() => void updateSettings({ ack: a })} />
              {a}
            </label>
          {/each}
        </span>
      </div>
      <label class="row">
        <span class="row-main"><span class="row-title">Work dupes</span><span class="row-sub">Same day, band and mode</span></span>
        <input class="switch" type="checkbox" role="switch" checked={settings.workDupes} onchange={(e) => void updateSettings({ workDupes: (e.currentTarget as HTMLInputElement).checked })} />
      </label>
      <label class="row">
        <span class="row-main"><span class="row-title">Tail-end</span><span class="row-sub">Call once more after their QSO</span></span>
        <input class="switch" type="checkbox" role="switch" checked={settings.tailEnd} onchange={(e) => void updateSettings({ tailEnd: (e.currentTarget as HTMLInputElement).checked })} />
      </label>
      <label class="row">
        <span class="row-main"><span class="row-title">Watchdog</span></span>
        <input class="switch" type="checkbox" role="switch" checked={settings.watchdog} onchange={(e) => void updateSettings({ watchdog: (e.currentTarget as HTMLInputElement).checked })} />
      </label>
      {#if settings.watchdog}
        <label class="row">
          <span class="row-title">Stop Tx after</span>
          <input
            class="field num"
            type="text"
            inputmode="decimal"
            bind:value={watchdogMin}
            onblur={saveWatchdog}
            onkeydown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
            autocomplete="off"
            aria-label="Stop Tx after, min"
          />
          <span class="unit">min</span>
        </label>
      {/if}
      <label class="row">
        <span class="row-main"><span class="row-title">Hold Tx frequency</span></span>
        <input class="switch" type="checkbox" role="switch" checked={settings.holdTx} onchange={(e) => void updateSettings({ holdTx: (e.currentTarget as HTMLInputElement).checked })} />
      </label>
    </div>
  </div>

</section>

<style>
  .sub {
    padding-top: var(--rr-safe-top);
  }

  .ack {
    width: 160px;
  }

  .field {
    flex: 1;
    min-width: 0;
    height: var(--rr-tap);
    border: 0;
    background: transparent;
    font-size: var(--rr-text-body);
    text-align: right;
  }

  .field.num {
    font-variant-numeric: tabular-nums;
  }

  .unit {
    flex: none;
    color: var(--rr-label2);
  }

  .field:focus {
    outline: none;
  }

  .row:has(.field:focus-visible) {
    box-shadow: inset 0 0 0 2px var(--rr-accent);
  }
</style>
