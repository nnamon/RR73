<script lang="ts">
  /** Station detail, from touch and hold: Call first, then the facts, then the signal over its last slots. */
  import Sheet from './Sheet.svelte';
  import { dt, signed, utcHm, utcTime } from '../lib/clock/format';
  import { bare, parseExchange } from '../lib/qso/messages';
  import { gridPath } from '../lib/reference/grid';
  import { clock } from '../lib/state/now.svelte';
  import { settings } from '../lib/state/settings.svelte';
  import { callStart, callStation, qso, type Selected } from '../lib/state/qso.svelte';
  import { log } from '../lib/log/log.svelte';
  import { displayMode } from '../lib/log/qso';
  import { signalHistory } from '../lib/decode/signal';
  import { band } from '../lib/state/station.svelte';
  import { isFt } from '../lib/clock/slots';
  import SignalChart from './SignalChart.svelte';

  let { open = $bindable(false), item }: { open: boolean; item: Selected | null } = $props();

  const ex = $derived(item ? parseExchange(item.decode.text) : null);
  const me = $derived(settings.callsign.toUpperCase());
  const call = $derived.by(() => {
    if (!ex) return null;
    if (ex.kind === 'cq') return ex.from;
    if (ex.to && bare(ex.to) === me) return ex.from;
    if (ex.from && bare(ex.from) === me) return ex.to;
    return ex.from ?? ex.to;
  });
  const grid = $derived(ex?.grid ?? null);
  const path = $derived(grid && settings.grid ? gridPath(settings.grid, grid) : null);
  const start = $derived(item ? callStart(item.slotStartMs, clock.ms) : null);
  const worked = $derived(call ? log.live.filter((q) => q.call === bare(call)).slice(0, 3) : []);
  const today = $derived(new Date(clock.ms).toISOString().slice(0, 10));
  const when = (ms: number) => (new Date(ms).toISOString().slice(0, 10) === today ? `at ${utcHm(ms)}` : `on ${new Date(ms).toISOString().slice(0, 10)}`);
  const ord = (p: 'even' | 'odd') => (p === 'even' ? 'Even' : 'Odd');
  // The station's last slots of its parity, from the hour Band activity keeps.
  const signal = $derived(call && isFt(settings.mode) ? signalHistory(band.slots, bare(call), settings.mode) : []);

  function doCall() {
    if (!item) return;
    callStation(item.decode, item.slotStartMs);
    open = false;
  }
</script>

<Sheet bind:open title={call ? bare(call) : 'Station'}>
  {#if item && call && start}
    <p class="sub">{[grid, path ? `${Math.round(path.km).toLocaleString('en-GB')} km` : null, path ? `${Math.round(path.bearingDeg)}°` : null].filter(Boolean).join(' · ') || 'No grid received'}</p>
    {#if ex?.kind === 'cq'}<p class="tags"><span class="tag cq">CQ{ex.modifier ? ` ${ex.modifier}` : ''}</span></p>{/if}
    <button class="btn primary big" onclick={doCall} disabled={!!qso.st.partner && bare(qso.st.partner.call) === bare(call)}>
      <b>Call {bare(call)}</b>
      <span>Starts {utcTime(start.startMs)} ({ord(start.parity)})</span>
    </button>
    <ul class="group facts">
      <li class="row">
        <span class="row-main"><span class="row-title">Last decode</span><span class="row-sub">{utcTime(item.slotStartMs)} · {signed(Math.round(item.decode.snr_db))} dB · DT {dt(item.decode.dt_s)} s · {Math.round(item.decode.freq_hz)} Hz</span></span>
      </li>
      <li class="row">
        <span class="row-main"><span class="row-title">Message</span><span class="row-sub mono">{item.decode.text}</span></span>
      </li>
      <li class="row">
        <span class="row-main">
          <span class="row-title">Worked before</span>
          <span class="row-sub">{worked.length ? worked.map((q) => `${q.band} ${displayMode(q)} ${when(q.start)}`).join(', ') : 'Not yet'}</span>
        </span>
      </li>
    </ul>
    {#if signal.length}<SignalChart points={signal} />{/if}
  {/if}
</Sheet>

<style>
  .sub {
    margin-top: var(--rr-space-1);
    font-size: var(--rr-text-sub);
    color: var(--rr-label2);
    text-align: center;
  }

  .tags {
    display: flex;
    justify-content: center;
    margin-top: var(--rr-space-2);
  }

  .tag {
    padding: 0 var(--rr-space-2);
    border-radius: var(--rr-radius-s);
    font-size: var(--rr-text-foot);
    font-weight: var(--rr-weight-bold);
    line-height: 26px;
  }

  .tag.cq {
    background: var(--rr-ok);
    color: var(--rr-on-strong);
  }

  .big {
    flex-direction: column;
    width: 100%;
    min-height: var(--rr-button-large);
    margin-top: var(--rr-space-3);
  }

  .big span {
    font-size: var(--rr-text-foot);
    font-weight: var(--rr-weight-medium);
  }

  .facts {
    margin-top: var(--rr-space-3);
    background: var(--rr-sheet-card);
  }
</style>
