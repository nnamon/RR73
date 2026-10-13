<script lang="ts">
  /**
   * The transmit dock: where the QSO stands, the next message and when it starts, and the
   * controls. Halt is the largest control in every state and always enabled, at the right of the
   * bottom row; at most 3 buttons share a row.
   */
  import { utcTime, signed } from '../lib/clock/format';
  import { parseExchange, bare } from '../lib/qso/messages';
  import { pathBetween } from '../lib/qso/grid';
  import { notReady } from '../lib/qso/sequencer';
  import { nextLine, runTally, statusLine, steps, watchdogText } from '../lib/qso/view';
  import { clock } from '../lib/state/now.svelte';
  import { settings } from '../lib/state/settings.svelte';
  import { callCq, callStart, callStation, endQso, haltTx, qso, runRate, setRun, setStopAfter, setTxEnabled } from '../lib/state/qso.svelte';
  import { href } from '../lib/app/router.svelte';
  import Icon from './Icon.svelte';

  let { onconfirmband, onmessages, ondetail }: { onconfirmband: () => void; onmessages: () => void; ondetail: () => void } = $props();

  const st = $derived(qso.st);
  const blocked = $derived(notReady(st));
  const needsSetup = $derived(!st.config.myCall.trim() || blocked?.startsWith('Set your'));
  const partner = $derived(st.partner);
  const sel = $derived(qso.selected);
  const selEx = $derived(sel ? parseExchange(sel.decode.text) : null);
  const selCall = $derived.by(() => {
    if (!selEx) return null;
    const me = st.config.myCall.toUpperCase();
    if (selEx.kind === 'cq') return selEx.from;
    if (selEx.to && bare(selEx.to) === me) return selEx.from;
    if (selEx.from && bare(selEx.from) === me) return selEx.to;
    return selEx.from ?? selEx.to;
  });
  const showSelection = $derived(!!sel && !!selCall && (!partner || bare(partner.call) !== bare(selCall)));
  const selStart = $derived(sel ? callStart(sel.slotStartMs, clock.ms) : null);
  const where = (grid: string | null) => {
    if (!grid) return '';
    const p = settings.grid ? pathBetween(settings.grid, grid) : null;
    return p ? `${grid} · ${Math.round(p.km).toLocaleString('en-GB')} km · ${Math.round(p.bearing)}°` : grid;
  };
  const next = $derived(nextLine(st, clock.ms));
  const stepList = $derived(steps(st));
  const status = $derived(statusLine(st, clock.ms, settings.holdTx));
  const onAir = $derived(qso.onAir);
  const elapsed = $derived(onAir ? Math.max(0, Math.min(onAir.endMs, clock.ms) - onAir.startMs) / 1000 : 0);
  const total = $derived(onAir ? (onAir.endMs - onAir.startMs) / 1000 : 0);
  const notice = $derived(qso.notice && clock.ms - qso.notice.atMs < 20_000 ? qso.notice : null);
  const tally = $derived(runTally(runRate(clock.ms)));
  const watchdog = $derived(watchdogText(st, clock.ms));
  /** The gesture hint goes for good once the operator has tapped and double-tapped a decode. */
  const gesturesKnown = $derived(settings.tapUsed && settings.doubleTapUsed);
  const ord = (p: 'even' | 'odd') => (p === 'even' ? '1st' : '2nd');
</script>

<section class="dock" class:onair={!!onAir} aria-label="Transmit">
  {#if onAir}
    <div class="air" role="status">
      <span class="pill">On air</span>
      <span class="t">Tx {onAir.tx} · <span class="m">{onAir.text}</span></span>
      <span class="c2">{elapsed.toFixed(1)} of {total.toFixed(1)} s</span>
    </div>
    <div class="bar" aria-hidden="true"><i style:width="{total ? (elapsed / total) * 100 : 0}%"></i></div>
  {/if}

  {#if needsSetup}
    <p class="why">{blocked ?? 'Set your callsign and grid in Settings to transmit.'}</p>
  {:else if showSelection && sel && selCall && selStart}
    <div class="sel">
      <div class="l1">
        <span class="call mono">{bare(selCall)}</span>
        {#if selEx?.kind === 'cq'}<span class="tag cq">CQ{selEx.modifier ? ` ${selEx.modifier}` : ''}</span>{/if}
        <button class="info" aria-label="Show station details" onclick={ondetail}><Icon name="info" size={24} /></button>
      </div>
      <p class="sub">{where(selEx?.grid ?? null) || `${signed(Math.round(sel.decode.snr_db))} dB · ${Math.round(sel.decode.freq_hz)} Hz`}</p>
    </div>
  {:else if partner}
    <div class="q1">
      <span class="call mono">{bare(partner.call)}</span>
      <span class="sub">{where(partner.grid) || `${Math.round(partner.freqHz)} Hz`}</span>
    </div>
    <ol class="steps" aria-label="QSO progress">
      {#each stepList as s, i (i)}
        <li class="step {s.state}"><i><b></b></i><span>{s.label}</span></li>
      {/each}
    </ol>
  {:else if st.phase === 'cq' && !st.run}
    <div class="q1"><span class="call">Calling CQ</span><span class="sub">{ord(st.config.cqParity)} slots</span></div>
  {/if}

  {#if next && !showSelection && !needsSetup}
    <div class="next">
      <p class="l1"><span class="m">{next.title}</span></p>
      <p class="l2">{next.detail}</p>
    </div>
  {/if}

  {#if notice}
    <p class="notice" role="status">{notice.text}</p>
  {:else if blocked && !needsSetup}
    <p class="notice" role="status">{blocked}</p>
  {/if}

  {#if st.phase !== 'idle' && !showSelection}
    <!-- In Run, the tally replaces Auto Seq and Hold Tx once the first QSO is logged. -->
    <p class="dstat">{#if st.run && tally}<b class="run">Run</b> · {tally} · {watchdog}{:else}{status}{/if}</p>
  {/if}

  <!-- Secondary controls sit above the main row, so Halt keeps its place at the bottom right.
       Run's own controls (Run off, CQ slots) sit above the caller queue, so the dock stays one row. -->
  {#if !needsSetup && st.bandConfirmed && !showSelection && !st.run}
    <div class="row2">
      {#if st.phase === 'idle' && !blocked && !gesturesKnown}
        <p class="hint">Tap a decode to select it, double-tap to call. Touch and hold for details.</p>
      {/if}
      <button class="btn compact sec" onclick={onmessages}>Edit messages</button>
      {#if st.phase !== 'idle' && partner}
        <button class="btn compact sec" onclick={endQso}>End QSO</button>
      {/if}
    </div>
  {/if}

  <div class="ctl">
    {#if needsSetup}
      <a class="btn sec" href={href('settings')}>Open Settings</a>
    {:else if !st.bandConfirmed}
      <button class="btn primary" onclick={onconfirmband}>Confirm band</button>
    {:else if showSelection && sel && selCall && selStart}
      <button class="btn primary call-btn" onclick={() => callStation(sel.decode, sel.slotStartMs)}>
        <b>Call {bare(selCall)}</b>
        <span>Starts {utcTime(selStart.startMs)} ({ord(selStart.parity)})</span>
      </button>
    {:else if st.run}
      <button class="btn sec stopafter" aria-pressed={st.stopAfter} class:on={st.stopAfter} onclick={() => setStopAfter(!st.stopAfter)}>Stop after this QSO</button>
    {:else if st.phase === 'idle'}
      <button class="btn sec" onclick={callCq}>Call CQ</button>
      <button class="btn sec" onclick={() => setRun(true)}>Run</button>
    {:else}
      <button class="btn" class:en-on={st.txEnabled} aria-pressed={st.txEnabled} onclick={() => setTxEnabled(!st.txEnabled)}>Enable Tx</button>
    {/if}
    <button class="btn halt" onclick={haltTx}>Halt</button>
  </div>
</section>

<style>
  .dock {
    position: sticky;
    bottom: 0;
    z-index: 2;
    flex: none;
    padding: var(--rr-space-2) calc(var(--rr-space-4) + var(--rr-safe-right)) var(--rr-space-2) calc(var(--rr-space-4) + var(--rr-safe-left));
    background: var(--rr-dock);
    box-shadow: 0 calc(-1 * var(--rr-hairline)) 0 var(--rr-sep-strong);
  }

  .dock.onair {
    box-shadow: inset 0 3px 0 var(--rr-tx);
  }

  .air {
    display: flex;
    gap: var(--rr-space-2);
    align-items: center;
    min-height: 20px;
    font-size: var(--rr-text-row);
    white-space: nowrap;
  }

  .pill {
    flex: none;
    padding: 0 var(--rr-space-2);
    border-radius: var(--rr-radius-s);
    background: var(--rr-tx-fill);
    color: var(--rr-on-fill);
    font-size: var(--rr-text-caption);
    font-weight: var(--rr-weight-bold);
    line-height: 20px;
  }

  .air .t {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    font-weight: var(--rr-weight-bold);
    text-overflow: ellipsis;
  }

  .m {
    font-family: var(--rr-mono);
    letter-spacing: 0;
  }

  .air .c2 {
    flex: none;
    font-size: var(--rr-text-foot);
    color: var(--rr-label2);
  }

  .bar {
    height: 4px;
    margin-top: var(--rr-space-1);
    overflow: hidden;
    border-radius: 2px;
    background: var(--rr-fill2);
  }

  .bar i {
    display: block;
    height: 100%;
    background: var(--rr-tx);
  }

  .why,
  .hint {
    font-size: var(--rr-text-foot);
    line-height: var(--rr-leading-row);
    color: var(--rr-label2);
  }

  .why {
    color: var(--rr-label);
    font-weight: var(--rr-weight-semibold);
  }

  .sel .l1,
  .q1 {
    display: flex;
    gap: var(--rr-space-2);
    align-items: baseline;
    overflow: hidden;
    white-space: nowrap;
  }

  .sel .l1 {
    align-items: center;
    overflow: visible;
  }

  .sel .call {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Station details: a 44 pt target on the 22 pt call line. The margins keep the line's height,
     and the glyph ends 16 pt from the edge, as bar buttons do. */
  .info {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: var(--rr-tap);
    height: var(--rr-tap);
    margin: calc((var(--rr-leading-body) - var(--rr-tap)) / 2) calc(-1 * (var(--rr-space-3) + var(--rr-space-px))) calc((var(--rr-leading-body) - var(--rr-tap)) / 2) auto;
    border-radius: var(--rr-radius-l);
    color: var(--rr-accent);
  }

  .info:focus-visible {
    outline: 2px solid var(--rr-accent);
    outline-offset: -2px;
  }

  .call {
    font-size: var(--rr-text-clock);
    font-weight: var(--rr-weight-bold);
    line-height: var(--rr-leading-body);
    letter-spacing: -0.01em;
  }

  .sel .call {
    font-size: var(--rr-text-title);
  }

  .sub {
    overflow: hidden;
    font-size: var(--rr-text-foot);
    line-height: var(--rr-leading-row);
    color: var(--rr-label2);
    text-overflow: ellipsis;
  }

  .tag {
    padding: 0 var(--rr-space-2);
    border-radius: var(--rr-radius-s);
    font-size: var(--rr-text-caption);
    font-weight: var(--rr-weight-bold);
    line-height: 20px;
  }

  .tag.cq {
    background: var(--rr-ok);
    color: var(--rr-on-strong);
  }

  .steps {
    display: flex;
    gap: var(--rr-space-1);
    margin-top: var(--rr-space-1);
  }

  .step {
    flex: 1;
    min-width: 0;
  }

  .step i {
    position: relative;
    display: block;
    height: 4px;
    overflow: hidden;
    border-radius: 2px;
    background: var(--rr-fill2);
  }

  .step i b {
    position: absolute;
    inset: 0 auto 0 0;
    width: 0;
    background: var(--rr-accent-fill);
  }

  .step.done i b {
    width: 100%;
  }

  .step.now i {
    box-shadow: inset 0 0 0 1px var(--rr-accent);
    background: transparent;
  }

  .step span {
    display: block;
    margin-top: var(--rr-space-half);
    overflow: hidden;
    font-size: var(--rr-text-caption);
    font-weight: var(--rr-weight-medium);
    line-height: var(--rr-leading-caption);
    color: var(--rr-label2);
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .step.now span {
    color: var(--rr-accent);
    font-weight: var(--rr-weight-bold);
  }

  .next {
    margin-top: var(--rr-space-1-5);
    padding: var(--rr-space-1) var(--rr-space-3);
    border-radius: var(--rr-radius-l);
    background: var(--rr-fill);
  }

  .next .l1 {
    overflow: hidden;
    font-size: var(--rr-text-row);
    font-weight: var(--rr-weight-semibold);
    line-height: var(--rr-leading-row);
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .next .l2 {
    font-size: var(--rr-text-foot);
    line-height: var(--rr-leading-foot);
    color: var(--rr-label2);
  }

  .notice {
    margin-top: var(--rr-space-1-5);
    font-size: var(--rr-text-foot);
    font-weight: var(--rr-weight-semibold);
    line-height: var(--rr-leading-foot);
    color: var(--rr-warn);
  }

  .dstat {
    margin-top: var(--rr-space-1);
    overflow: hidden;
    font-size: var(--rr-text-foot);
    line-height: var(--rr-leading-foot);
    color: var(--rr-label2);
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .row2 {
    display: flex;
    gap: var(--rr-space-2);
    align-items: center;
    justify-content: flex-end;
    margin-top: var(--rr-space-2);
  }

  .row2 .hint {
    flex: 1;
    min-width: 0;
    line-height: var(--rr-leading-foot);
  }

  .dstat .run {
    color: var(--rr-ok);
  }

  .ctl {
    display: flex;
    gap: var(--rr-space-2);
    margin-top: var(--rr-space-2);
  }

  .ctl .btn {
    min-width: var(--rr-tap);
  }

  .sec {
    background: var(--rr-fill);
  }

  .en-on {
    background: var(--rr-accent-fill);
    color: var(--rr-on-fill);
  }

  /* One line at 375 pt; Halt takes the rest of the row. */
  .ctl .stopafter {
    flex: none;
    padding: 0 var(--rr-space-3);
    font-size: var(--rr-text-sub);
    white-space: nowrap;
  }

  .stopafter.on {
    box-shadow: inset 0 0 0 2px var(--rr-accent);
  }

  /* As wide as "Starts 13:15:00 (2nd)" needs; Halt takes the rest and stays larger. */
  .ctl .call-btn {
    min-width: max-content;
  }

  .call-btn {
    flex-direction: column;
    min-height: var(--rr-button-large);
    line-height: var(--rr-leading-foot);
  }

  .call-btn span {
    font-size: var(--rr-text-foot);
    font-weight: var(--rr-weight-medium);
  }

  /* Halt is the largest control: widest and tallest in the row. */
  .ctl .halt {
    flex: 1.6;
  }
</style>
