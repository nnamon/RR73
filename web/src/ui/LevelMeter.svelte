<script lang="ts">
  /**
   * Input level. "mini" sits in the Operate header; "full" in Radio and audio, with the target
   * zone and a dBFS scale.
   */
  import { signed } from '../lib/clock/format';
  import { FLOOR_DB, TARGET_DB } from '../lib/audio/level';

  let { rmsDb, live, variant = 'mini' }: { rmsDb: number; live: boolean; variant?: 'mini' | 'full' } = $props();

  const MIN = -60;
  const pct = (db: number) => Math.max(0, Math.min(100, ((db - MIN) / -MIN) * 100));
  const hasSignal = $derived(live && rmsDb > FLOOR_DB);
  const inside = $derived(rmsDb >= TARGET_DB.low && rmsDb <= TARGET_DB.high);
  const text = $derived(hasSignal ? `${signed(Math.round(rmsDb))} dBFS` : 'No audio');
  const tone = $derived(!hasSignal ? 'off' : inside ? 'ok' : 'warn');
  const message = $derived(
    !live
      ? 'No audio. Start audio to see the input level.'
      : !hasSignal
        ? 'The input is silent. Check the cable and the radio’s audio output.'
        : inside
          ? `Band noise at ${signed(Math.round(rmsDb))} dBFS, inside the target range.`
          : rmsDb < TARGET_DB.low
            ? `Input at ${signed(Math.round(rmsDb))} dBFS, below the target range. Raise the radio’s audio output.`
            : `Input at ${signed(Math.round(rmsDb))} dBFS, above the target range. Lower the radio’s audio output.`,
  );
</script>

{#if variant === 'mini'}
  <div class="mini {tone}" role="meter" aria-label="Input level" aria-valuemin={MIN} aria-valuemax={0} aria-valuenow={hasSignal ? Math.round(rmsDb) : MIN} aria-valuetext={text}>
    <i><b style:width="{hasSignal ? pct(rmsDb) : 0}%"></b></i>
    <!-- With audio off the audio banner says so; the meter only shows the empty bar. -->
    {#if live}<span>{text}</span>{/if}
  </div>
{:else}
  <div class="full">
    <div class="meter" role="meter" aria-label="Input level" aria-valuemin={MIN} aria-valuemax={0} aria-valuenow={hasSignal ? Math.round(rmsDb) : MIN} aria-valuetext={text}>
      <div class="zone" style:left="{pct(TARGET_DB.low)}%" style:width="{pct(TARGET_DB.high) - pct(TARGET_DB.low)}%"></div>
      <div class="track"><i class={tone} style:width="{hasSignal ? pct(rmsDb) : 0}%"></i></div>
      <div class="scale" aria-hidden="true">
        <span style:left="0%">{signed(-60)}</span>
        <span style:left="{pct(-40)}%">{signed(-40)}</span>
        <span style:left="{pct(-20)}%">{signed(-20)}</span>
        <span style:left="100%">0</span>
      </div>
    </div>
    <p class="msg {tone}" aria-live="polite">{message}</p>
  </div>
{/if}

<style>
  .mini {
    display: flex;
    align-items: center;
    height: 15px;
    margin-top: var(--rr-space-half);
  }

  .mini i {
    position: relative;
    display: block;
    width: var(--rr-meter-mini);
    height: 5px;
    overflow: hidden;
    border-radius: 2.5px;
    background: var(--rr-fill2);
  }

  .mini b {
    position: absolute;
    inset: 0 auto 0 0;
    border-radius: 2.5px;
    background: var(--rr-ok-bar);
    transition: width 80ms linear;
  }

  .mini.warn b {
    background: var(--rr-warn);
  }

  .mini span {
    margin-left: var(--rr-space-2);
    font-size: var(--rr-text-caption);
    font-weight: var(--rr-weight-semibold);
    line-height: var(--rr-leading-caption);
    letter-spacing: 0;
    color: var(--rr-ok);
  }

  .mini.warn span {
    color: var(--rr-warn);
  }

  .mini.off span {
    color: var(--rr-tx-text);
  }

  .full {
    width: 100%;
  }

  .meter {
    position: relative;
    height: 32px;
    margin-top: var(--rr-space-2);
  }

  .zone {
    position: absolute;
    top: 0;
    height: 13px;
    border-radius: var(--rr-radius-s);
    background: var(--rr-ok-soft);
    box-shadow: inset 0 0 0 1px var(--rr-ok-bar);
  }

  .track {
    position: absolute;
    top: 3.5px;
    right: 0;
    left: 0;
    height: 6px;
    overflow: hidden;
    border-radius: 3px;
    background: var(--rr-fill2);
  }

  .track i {
    display: block;
    height: 100%;
    border-radius: 3px;
    background: var(--rr-ok-bar);
    transition: width 80ms linear;
  }

  .track i.warn {
    background: var(--rr-warn);
  }

  .scale {
    position: absolute;
    top: 17px;
    right: 0;
    left: 0;
    height: 15px;
  }

  .scale span {
    position: absolute;
    font-size: var(--rr-text-caption);
    line-height: var(--rr-leading-caption);
    letter-spacing: 0;
    color: var(--rr-label2);
    transform: translateX(-50%);
  }

  .scale span:first-child {
    transform: none;
  }

  .scale span:last-child {
    transform: translateX(-100%);
  }

  .msg {
    margin-top: var(--rr-space-half);
    font-size: var(--rr-text-foot);
    font-weight: var(--rr-weight-semibold);
    line-height: var(--rr-leading-row);
    color: var(--rr-label2);
  }

  .msg.ok {
    color: var(--rr-ok);
  }

  .msg.warn {
    color: var(--rr-warn);
  }
</style>
