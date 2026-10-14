<script lang="ts">
  /**
   * Settings › WSPR (ADR 0006, docs/design/wspr.md): the beacon's Tx percentage, reported power,
   * Tx frequency and Stop beacon after, the message it sends, and the order of the spots.
   */
  import BackLink from '../ui/BackLink.svelte';
  import Icon from '../ui/Icon.svelte';
  import { href } from '../lib/app/router.svelte';
  import { POWERS_DBM, powerText } from '../lib/wspr/power';
  import { STOP_AFTER_STEPS_MIN, TX_PCTS, durationText, normaliseStopAfter } from '../lib/wspr/schedule';
  import { SORT_LABELS, SPOT_SORTS, type SpotSort } from '../lib/wspr/spots';
  import { FREQ_LIMITS, clampHz } from '../lib/waterfall/pick';
  import { settings, updateSettings, type WsprSettings } from '../lib/state/settings.svelte';
  import { codec } from '../lib/state/station.svelte';
  import { beaconTexts, setTxPct, setWsprTxHz, wspr } from '../lib/state/wspr.svelte';

  const w = $derived(settings.wspr);
  const limits = FREQ_LIMITS.WSPR;

  function save(patch: Partial<WsprSettings>) {
    void updateSettings({ wspr: { ...settings.wspr, ...patch } });
  }

  function stepPct(dir: 1 | -1) {
    const i = TX_PCTS.indexOf(w.txPct) + dir;
    if (i >= 0 && i < TX_PCTS.length) setTxPct(TX_PCTS[i]);
  }

  let txHz = $state(String(settings.wspr.txHz));
  $effect(() => {
    txHz = String(settings.wspr.txHz);
  });

  /** A whole number of Hz, kept inside the window; anything else puts back the stored value. */
  function saveTxHz() {
    const v = Number(txHz.trim());
    if (!txHz.trim() || !Number.isFinite(v)) txHz = String(settings.wspr.txHz);
    else {
      const hz = clampHz(v, 'WSPR');
      txHz = String(hz);
      setWsprTxHz(hz);
    }
  }

  // Stop beacon after: Off, the usual durations, or any number of minutes (Other).
  const OTHER = -1;
  let other = $state(!STOP_AFTER_STEPS_MIN.includes(settings.wspr.stopAfterMin));
  const choice = $derived(other ? OTHER : w.stopAfterMin);
  let stopMin = $state(String(settings.wspr.stopAfterMin));
  $effect(() => {
    stopMin = String(settings.wspr.stopAfterMin);
  });

  function setStopAfter(min: number) {
    save({ stopAfterMin: min });
    if (wspr.beacon.on) wspr.beacon = { ...wspr.beacon, stopsAtMs: min > 0 ? wspr.beacon.startedAtMs + min * 60_000 : null };
  }

  function chooseStop(v: number) {
    other = v === OTHER;
    if (!other) setStopAfter(v);
  }

  function saveStopMin() {
    const m = normaliseStopAfter(Number(stopMin.trim()));
    if (!stopMin.trim() || m === null) stopMin = String(settings.wspr.stopAfterMin);
    else {
      setStopAfter(m);
      if (STOP_AFTER_STEPS_MIN.includes(m)) other = false;
    }
  }

  const message = $derived(beaconTexts());
  // The codec has the last word on a callsign: one too long for its message type cannot be sent.
  let refused = $state(false);
  $effect(() => {
    const b = message;
    refused = false;
    if (!b.ok) return;
    let current = true;
    void Promise.all(b.texts.map((t) => codec().pack(t, 'WSPR').catch(() => null))).then((r) => {
      if (current) refused = r.some((p) => p !== null && !p.ok);
    });
    return () => {
      current = false;
    };
  });
  const compoundNoGrid = $derived(message.ok && message.texts.length === 1 && message.texts[0].split(' ').length === 2);
</script>

<section class="screen sub" aria-labelledby="wspr-title">
  <BackLink to={href('settings')} label="Settings" title="WSPR" id="wspr-title" />

  <div class="section">
    <h2 class="section-head">Beacon</h2>
    <div class="group">
      <div class="row">
        <span class="row-main"><span class="row-title" id="wspr-pct">Tx percentage</span></span>
        <span class="row-value pct" aria-live="polite">{w.txPct}%</span>
        <span class="stepper" role="group" aria-labelledby="wspr-pct">
          <button type="button" aria-label="Lower Tx percentage" disabled={w.txPct <= TX_PCTS[0]} onclick={() => stepPct(-1)}><span class="minus" aria-hidden="true"></span></button>
          <button type="button" aria-label="Raise Tx percentage" disabled={w.txPct >= TX_PCTS[TX_PCTS.length - 1]} onclick={() => stepPct(1)}><Icon name="plus" size={18} /></button>
        </span>
      </div>
      <label class="row">
        <span class="row-title">Reported power</span>
        <select class="select" value={w.powerDbm} onchange={(e) => save({ powerDbm: Number(e.currentTarget.value) })}>
          {#each POWERS_DBM as p (p)}
            <option value={p}>{powerText(p)}</option>
          {/each}
        </select>
        <Icon name="updown" size={13} class="row-chevron" />
      </label>
      <label class="row">
        <span class="row-title">Tx frequency</span>
        <input
          class="field num"
          type="text"
          inputmode="numeric"
          bind:value={txHz}
          onblur={saveTxHz}
          onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          autocomplete="off"
          aria-label="Tx frequency, Hz, {limits.minHz} to {limits.maxHz}"
        />
        <span class="unit">Hz</span>
      </label>
      <label class="row">
        <span class="row-title">Stop beacon after</span>
        <select class="select" value={choice} onchange={(e) => chooseStop(Number(e.currentTarget.value))}>
          {#each STOP_AFTER_STEPS_MIN as m (m)}
            <option value={m}>{durationText(m)}</option>
          {/each}
          <option value={OTHER}>Other</option>
        </select>
        <Icon name="updown" size={13} class="row-chevron" />
      </label>
      {#if other}
        <label class="row">
          <span class="row-title">Minutes</span>
          <input
            class="field num"
            type="text"
            inputmode="numeric"
            bind:value={stopMin}
            onblur={saveStopMin}
            onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            autocomplete="off"
            aria-label="Stop beacon after, min"
          />
          <span class="unit">min</span>
        </label>
      {/if}
      <div class="row">
        <span class="row-title">Message</span>
        {#if !message.ok}
          <span class="row-value">{message.error}</span>
        {:else if refused}
          <span class="row-value err">Callsign cannot be sent in WSPR</span>
        {:else}
          <span class="row-value msg mono">
            {#each message.texts as t (t)}<span>{t}</span>{/each}
          </span>
        {/if}
      </div>
    </div>
    {#if compoundNoGrid}<p class="section-foot">A compound callsign sends its grid only with a 6-character grid.</p>{/if}
  </div>

  <div class="section">
    <h2 class="section-head" id="wspr-sort">Sort spots by</h2>
    <div class="seg" role="radiogroup" aria-labelledby="wspr-sort">
      {#each SPOT_SORTS as s (s)}
        <label class="seg-i" class:on={w.sort === s}>
          <input class="visually-hidden" type="radio" name="wspr-sort" value={s} checked={w.sort === s} onchange={() => save({ sort: s as SpotSort })} />
          {SORT_LABELS[s]}
        </label>
      {/each}
    </div>
  </div>
</section>

<style>
  .sub {
    padding-top: var(--rr-safe-top);
  }

  .pct {
    margin-right: var(--rr-space-3);
    font-variant-numeric: tabular-nums;
  }

  /* iOS's stepper: two 44 pt targets over one 32 pt grey capsule, a hairline between them. */
  .stepper {
    display: flex;
    flex: none;
    height: 32px;
    border-radius: var(--rr-radius-button);
    background: var(--rr-fill-bg);
  }

  .stepper button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--rr-tap);
    height: var(--rr-tap);
    margin: calc(-1 * var(--rr-space-1-5)) 0;
    color: var(--rr-label);
  }

  .stepper button + button {
    background: linear-gradient(var(--rr-sep-strong), var(--rr-sep-strong)) left center / var(--rr-hairline) 18px no-repeat;
  }

  .stepper button:disabled {
    opacity: 0.35;
  }

  .stepper button:focus-visible {
    outline: 2px solid var(--rr-accent);
    outline-offset: -2px;
    border-radius: var(--rr-radius-button);
  }

  .minus {
    width: 14px;
    height: 2px;
    border-radius: 1px;
    background: currentcolor;
  }

  .select {
    flex: 1;
    min-width: 0;
    height: var(--rr-tap);
    border: 0;
    background: transparent;
    color: var(--rr-label2);
    font-size: var(--rr-text-body);
    text-align: right;
    text-align-last: right;
    appearance: none;
  }

  .row :global(.row-chevron) {
    margin-left: var(--rr-space-1);
    color: var(--rr-chev);
  }

  .field {
    flex: 1;
    min-width: 0;
    height: var(--rr-tap);
    border: 0;
    background: transparent;
    color: var(--rr-label2);
    font-size: var(--rr-text-body);
    text-align: right;
  }

  .field.num {
    font-variant-numeric: tabular-nums;
  }

  .field:focus {
    outline: none;
  }

  .row:has(.field:focus-visible) {
    box-shadow: inset 0 0 0 2px var(--rr-accent);
  }

  .unit {
    flex: none;
    margin-left: var(--rr-space-1);
    color: var(--rr-label2);
  }

  .row-value {
    margin-left: auto;
    text-align: right;
  }

  .msg {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    padding: var(--rr-space-2) 0;
    font-size: var(--rr-text-sub);
    line-height: var(--rr-leading-sub);
  }

  .err {
    color: var(--rr-tx-text);
  }
</style>
