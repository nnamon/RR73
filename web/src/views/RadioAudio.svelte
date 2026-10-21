<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import BackLink from '../ui/BackLink.svelte';
  import Icon from '../ui/Icon.svelte';
  import LevelMeter from '../ui/LevelMeter.svelte';
  import TuneSheet from '../ui/TuneSheet.svelte';
  import { href, route } from '../lib/app/router.svelte';
  import { signed, utcHm, utcTime } from '../lib/clock/format';
  import { timingReport, type TimingSnapshot } from '../lib/clock/timing';
  import { clockText } from '../lib/clock/calibration';
  import type { Applied } from '../lib/audio/report';
  import type { Contrast } from '../lib/waterfall/levels';
  import { PALETTES, paletteSpec, stopTokens, type PaletteId } from '../lib/waterfall/colormap';
  import { settings, updateSettings, type Checklist } from '../lib/state/settings.svelte';
  import { outputChoiceSupported } from '../lib/audio/sink';
  import { monitorSupported } from '../lib/tx/monitor';
  import { audio, band, clockCheck, halt, inputDevices, outputDevices, refindInput, refindOutput, startAudio, startTune, timingSnapshot, tx, useInput, useOutput } from '../lib/state/station.svelte';
  import { catKeys as keysByCat, plannedDialHz, radioTraits, rig, rigConnected, txKeyer } from '../lib/state/radio.svelte';
  import { alcAdvice } from '../lib/radio/alc';
  import { advice } from '../lib/app/advice';
  import { Device, device } from '../lib/app/platform';

  let devices = $state<MediaDeviceInfo[]>([]);
  let outputs = $state<MediaDeviceInfo[]>([]);
  let tuneOpen = $state(false);
  const live = $derived(audio.status === 'running');
  const r = $derived(audio.report);
  // Chromium sends transmit audio to a chosen device; Safari has no way to, so the row hides there.
  const outputChoice = outputChoiceSupported();
  /** The chosen output is not among the devices the browser lists now. */
  const outputMissing = $derived(settings.outputDeviceId !== null && (audio.output.error === 'missing' || (outputs.length > 0 && !outputs.some((d) => d.deviceId === settings.outputDeviceId))));
  /**
   * Why transmit audio is not going to the chosen output, if it is not. Keying by CAT, System
   * default refuses every transmission (lib/state/radio.svelte.ts), so the line names the radio's
   * own device.
   */
  const outputFoot = $derived.by(() => {
    if (outputChoice && settings.outputDeviceId === null && keysByCat()) return `Key the radio with CAT needs ${radioTraits().audioDevice} here.`;
    if (!outputChoice || settings.outputDeviceId === null) return null;
    if (outputMissing) return 'The chosen output is not connected, so transmit audio plays through the system default.';
    if (audio.output.error === 'failed') return 'The browser refused the chosen output, so transmit audio plays through the system default.';
    return null;
  });

  function listDevices() {
    // The chosen input may be listed under a new ID too.
    void refindInput()
      .then(() => inputDevices())
      .then((d) => (devices = d));
    // The chosen output may be listed under a new ID; find it by name before showing the list.
    void refindOutput()
      .then(() => outputDevices())
      .then((d) => (outputs = d));
  }

  // Device labels are readable only after microphone permission, so list again once audio runs,
  // and whenever a device comes or goes.
  $effect(() => {
    void audio.status;
    listDevices();
  });
  $effect(() => {
    const md = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices;
    md?.addEventListener?.('devicechange', listDevices);
    return () => md?.removeEventListener?.('devicechange', listDevices);
  });

  // Leaving this screen halts Tune: Halt must stay in reach while anything plays.
  onDestroy(() => {
    if (tx.tuning) halt();
  });

  const onOff = (v: Applied) => (v === null ? 'not reported' : v ? 'on' : 'off');
  const rateText = $derived.by(() => {
    if (!r) return 'Unknown until audio starts';
    const parts = [`${r.contextRate} Hz`];
    if (r.trackRate && r.trackRate !== r.contextRate) parts.push(`microphone at ${r.trackRate} Hz`);
    if (r.measuredRate) parts.push(`measured ${Math.round(r.measuredRate)} Hz`);
    return parts.join(', ');
  });
  const channelText = $derived.by(() => {
    if (!r || r.arrivingChannels === null) return 'Unknown until audio starts';
    if (r.arrivingChannels === 1) return '1 arriving';
    return `${r.arrivingChannels} arriving, using the ${r.channelUsed}`;
  });
  const processingText = $derived(
    r ? `Echo cancellation ${onOff(r.echoCancellation)}, noise suppression ${onOff(r.noiseSuppression)}, auto gain ${onOff(r.autoGainControl)}` : 'Unknown until audio starts',
  );
  const screenText = $derived(audio.wake === 'refused' || audio.wake === 'unsupported' ? advice.screen : 'Stays on while audio runs');

  const CONTRASTS: { id: Contrast; label: string }[] = [
    { id: 'low', label: 'Low' },
    { id: 'normal', label: 'Normal' },
    { id: 'high', label: 'High' },
  ];

  /** A palette's colours left to right, from its tokens, for the strip under its name. */
  const ramp = (id: PaletteId) => {
    const at = paletteSpec(id).positions;
    return `linear-gradient(to right, ${stopTokens(id)
      .map((t, i) => `var(${t}) ${at[i] * 100}%`)
      .join(', ')})`;
  };

  const checks = advice.checklist;

  const keyingText = $derived.by(() => {
    const k = tx.keying;
    if (k === null) return 'Not checked yet. Start audio, then run Tune.';
    const at = utcHm(k.atUtcMs);
    if (k.passed === null)
      return k.source === 'tune' ? `Not checked at ${at}: receive audio was off. Start audio, then run Tune.` : `Not checked at ${at}: receive audio started after the chime. Start audio again.`;
    return k.passed ? `Passed at ${at}: receive audio dropped ${Math.round(k.dropDb ?? 0)} dB.` : `Failed at ${at}: receive audio did not drop. Check the radio’s VOX and the cable.`;
  });

  const decoderText = $derived.by(() => {
    const d = band.decoder;
    if (d.state === 'ready') return `${d.version}, loaded in ${Math.round(d.loadMs)} ms`;
    if (d.state === 'loading') return 'Loading';
    if (d.state === 'failed') return d.reason === 'crashed' ? 'Stopped' : 'Did not load';
    return 'Not loaded';
  });

  // Timing: measurements for checking receive and transmit timing on the air.
  let timing = $state<TimingSnapshot>(timingSnapshot());
  $effect(() => {
    const id = setInterval(() => (timing = timingSnapshot()), 1000);
    return () => clearInterval(id);
  });
  let copyState = $state<'idle' | 'copied' | 'failed'>('idle');
  let reportText = $state('');

  async function copyReport() {
    const text = timingReport(timingSnapshot());
    try {
      await navigator.clipboard.writeText(text);
      copyState = 'copied';
      reportText = '';
    } catch {
      copyState = 'failed';
      reportText = text;
    }
  }

  const secs = (v: number) => `${v > 0 && v.toFixed(2) !== '0.00' ? '+' : ''}${signed(v, 2)} s`;
  const medianText = $derived(
    timing.medianDtS === null ? 'Waiting for strong decodes' : `${secs(timing.medianDtS)} from ${timing.strongDecodes} decodes`,
  );
  // The Clock badge in the top bar opens this screen at Timing (#/settings/radio/timing).
  let timingSection = $state<HTMLElement>();
  // After the update: the app and the settings split put a newly opened screen at the top first.
  $effect(() => {
    if (route.path[2] !== 'timing') return;
    void tick().then(() => timingSection?.scrollIntoView({ block: 'start' }));
  });
  const clockRowText = $derived(timing.clockS === null ? 'Waiting for strong decodes' : `${clockText(timing.clockS)} by the decodes`);
  // The clock warning: what it means on the air and how to set the clock.
  const clockFoot = $derived.by(() => {
    const off = clockCheck.offS;
    if (off === null) return null;
    const by = clockText(off);
    const air = `${Math.abs(off).toFixed(1)} s ${off > 0 ? 'late' : 'early'}`;
    return `The ${device}’s clock runs ${by} by the decodes, so other stations hear you ${air}.${off < 0 ? ' A slow audio input reads the same.' : ''} ${advice.clockFix}`;
  });
  const offsetText = $derived(timing.inputOffsetS === 0 ? 'None yet' : `${secs(timing.inputOffsetS)} on receive audio`);
  const sourceText = $derived(
    timing.source === 'output' ? 'Output timestamps' : timing.source === 'current-time' ? 'Audio clock time' : 'Unknown until audio starts',
  );
  const driftText = $derived.by(() => {
    if (timing.driftPpm === null) return timing.source ? 'Measured after 1 minute of audio' : 'Unknown until audio starts';
    const ppm = Math.round(timing.driftPpm);
    return ppm === 0 ? '0 ppm' : `${Math.abs(ppm)} ppm, audio clock ${ppm > 0 ? 'slow' : 'fast'}`;
  });
  const gapText = $derived(
    !timing.source && timing.gaps === 0
      ? 'Unknown until audio starts'
      : timing.gaps === 0
        ? 'None since audio started'
        : `${timing.gaps} ${timing.gaps === 1 ? 'gap' : 'gaps'}, ${Math.round(timing.gapMs)} ms in total`,
  );
  // Slots the decoder was still busy for: the processor falls behind the band.
  const skippedText = $derived(timing.skippedSlots === 0 ? 'None since the app opened' : `${timing.skippedSlots} since the app opened, decoder busy`);
  const lagText = $derived(timing.captureLagMs === null ? 'Unknown until audio starts' : `${Math.round(timing.captureLagMs)} ms`);
  const heardText = $derived.by(() => {
    const h = timing.heardBack;
    if (!h.length) return 'Shows after you transmit';
    const last = h.find((x) => x.dtS !== null);
    if (!last) return `Not heard back in the last ${h.length === 1 ? 'transmission' : `${h.length} transmissions`}`;
    return `DT ${secs(last.dtS!)} at ${utcTime(last.slotStartUtcMs)} UTC, ${signed(last.snrDb ?? 0)} dB`;
  });
  const resumeLines = $derived(
    timing.resumes
      .slice(-3)
      .reverse()
      .map((r) => {
        const ms = (v: number | null) => (v === null ? 'none' : `${signed(v)} ms`);
        return r.resumedAtUtcMs === null ? `Stopped at ${utcTime(r.stoppedAtUtcMs)} UTC, offset ${ms(r.beforeMs)}` : `${utcTime(r.stoppedAtUtcMs)} to ${utcTime(r.resumedAtUtcMs)} UTC: offset ${ms(r.beforeMs)} before, ${ms(r.afterMs)} after`;
      }),
  );

  function toggle(key: keyof Checklist) {
    void updateSettings({ checklist: { ...settings.checklist, [key]: !settings.checklist[key] } });
  }

  function pickInput(e: Event) {
    const id = (e.currentTarget as HTMLSelectElement).value || null;
    const label = devices.find((d) => d.deviceId === id)?.label ?? '';
    void updateSettings({ inputDeviceId: id, inputDeviceLabel: label });
    void useInput(id);
  }

  // Tune goes out on the radio's dial whatever RR73's band: the dial rig control reads, else the
  // band's dial as the band sheet sets it.
  const tuneDialHz = $derived(rigConnected() && rig.hz !== null ? rig.hz : plannedDialHz(settings.band, settings.mode));

  // With rig control keying the radio, the chime keys nothing: the radio's OK to PTT replaces the keying check.
  const catKeys = $derived(txKeyer() !== null);

  function pickOutput(e: Event) {
    const id = (e.currentTarget as HTMLSelectElement).value || null;
    const label = outputs.find((d) => d.deviceId === id)?.label ?? '';
    void updateSettings({ outputDeviceId: id, outputDeviceLabel: label });
    void useOutput(id);
  }
</script>

<section class="screen sub" aria-labelledby="radio-title">
  <BackLink to={href('settings')} label="Settings" title="Radio and audio" id="radio-title" />

  <div class="section">
    <h2 class="section-head">Receive audio</h2>
    <div class="group">
      <label class="row">
        <span class="row-title">Input</span>
        <select class="select" value={settings.inputDeviceId ?? ''} onchange={pickInput}>
          <option value="">System default</option>
          {#each devices as d, i (d.deviceId || i)}
            {#if d.deviceId && d.deviceId !== 'default'}<option value={d.deviceId}>{d.label || `Input ${i + 1}`}</option>{/if}
          {/each}
        </select>
      </label>
      <div class="row meter-row">
        <div class="row-main">
          <span class="row-title">Level</span>
          <LevelMeter rmsDb={audio.rmsDb} {live} variant="full" />
        </div>
      </div>
      <div class="row stack">
        <span class="row-main"><span class="row-title" id="contrast">Waterfall contrast</span></span>
        <span class="seg" role="radiogroup" aria-labelledby="contrast">
          {#each CONTRASTS as c (c.id)}
            <label class="seg-i" class:on={settings.waterfallContrast === c.id}>
              <input class="visually-hidden" type="radio" name="contrast" value={c.id} checked={settings.waterfallContrast === c.id} onchange={() => void updateSettings({ waterfallContrast: c.id })} />
              {c.label}
            </label>
          {/each}
        </span>
      </div>
      <div class="row stack">
        <span class="row-main"><span class="row-title" id="wf-colours">Waterfall colours</span></span>
        <span class="seg" role="radiogroup" aria-labelledby="wf-colours">
          {#each PALETTES as p (p.id)}
            <label class="seg-i ramped" class:on={settings.waterfallPalette === p.id}>
              <input class="visually-hidden" type="radio" name="wf-colours" value={p.id} checked={settings.waterfallPalette === p.id} onchange={() => void updateSettings({ waterfallPalette: p.id })} />
              {p.label}
              <i class="ramp" style:background={ramp(p.id)} aria-hidden="true"></i>
            </label>
          {/each}
        </span>
      </div>
      <label class="row">
        <span class="row-main"><span class="row-title">Callsigns on the waterfall</span><span class="row-sub">FT8 and FT4</span></span>
        <input type="checkbox" role="switch" class="switch" checked={settings.waterfallCalls} onchange={(e) => void updateSettings({ waterfallCalls: e.currentTarget.checked })} />
      </label>
      <div class="row">
        <span class="row-main"><span class="row-title">Sample rate</span><span class="row-sub">{rateText}</span></span>
      </div>
      <div class="row">
        <span class="row-main"><span class="row-title">Channels</span><span class="row-sub">{channelText}</span></span>
      </div>
      <div class="row">
        <span class="row-main"><span class="row-title">Voice processing</span><span class="row-sub">{processingText}</span></span>
      </div>
      <div class="row">
        <span class="row-main"><span class="row-title">Screen</span><span class="row-sub">{screenText}</span></span>
      </div>
    </div>
    {#if !live}
      <div class="start">
        <button class="btn primary" onclick={() => void startAudio()}>Start audio</button>
      </div>
    {:else}
      <p class="section-foot">Set the level with the radio’s AGC on.</p>
    {/if}
  </div>

  <div class="section">
    <h2 class="section-head">Transmit audio</h2>
    <div class="group">
      {#if outputChoice}
        <label class="row">
          <span class="row-title">Output</span>
          <select class="select" value={settings.outputDeviceId ?? ''} onchange={pickOutput}>
            <option value="">System default</option>
            {#each outputs as d, i (d.deviceId)}
              <option value={d.deviceId}>{d.label || `Output ${i + 1}`}</option>
            {/each}
            <!-- Device names show only after microphone permission; until then the choice has no name. -->
            {#if settings.outputDeviceId && !outputs.some((d) => d.deviceId === settings.outputDeviceId)}
              <option value={settings.outputDeviceId}>{outputMissing ? 'Not connected' : 'Chosen output'}</option>
            {/if}
          </select>
        </label>
        {#if monitorSupported()}
          <label class="row">
            <span class="row-main"><span class="row-title">Monitor</span><span class="row-sub">Also plays Tx audio here</span></span>
            <select class="select" value={settings.monitorDeviceId ?? ''} onchange={(e) => void updateSettings({ monitorDeviceId: (e.currentTarget as HTMLSelectElement).value || null })}>
              <option value="">Off</option>
              {#each outputs as d, i (d.deviceId)}
                <option value={d.deviceId}>{d.label || `Output ${i + 1}`}</option>
              {/each}
            </select>
          </label>
          {#if settings.monitorDeviceId}
            <label class="row">
              <span class="row-title">Monitor level</span>
              <input
                class="slider"
                type="range"
                min="0"
                max="100"
                step="1"
                value={Math.round(settings.monitorLevel * 100)}
                oninput={(e) => void updateSettings({ monitorLevel: Number((e.currentTarget as HTMLInputElement).value) / 100 })}
              />
              <span class="row-value pct">{Math.round(settings.monitorLevel * 100)} %</span>
            </label>
          {/if}
        {/if}
      {/if}
      <label class="row">
        <span class="row-title">Output level</span>
        <input
          class="slider"
          type="range"
          min="0"
          max="100"
          step="1"
          value={Math.round(settings.outputLevel * 100)}
          oninput={(e) => void updateSettings({ outputLevel: Number((e.currentTarget as HTMLInputElement).value) / 100 })}
        />
        <span class="row-value pct">{Math.round(settings.outputLevel * 100)} %</span>
      </label>
      <div class="row check">
        <label class="check-label">
          <input type="checkbox" class="box" checked={settings.startTone} onchange={() => void updateSettings({ startTone: !settings.startTone })} />
          <span class="row-main">
            <span class="row-title">Start chime</span>
            <span class="row-sub">{catKeys ? 'Off while CAT keys the radio' : 'Keys the radio when audio starts'}</span>
          </span>
        </label>
      </div>
      <button
        class="row tune"
        onclick={() => {
          startTune();
          // Not opened when the radio refused: the line below the group says why.
          tuneOpen = tx.tuning;
        }}
      >
        <span class="row-main">
          <span class="row-title acc">Tune for 10 s</span>
        </span>
      </button>
    </div>
    {#if outputFoot}<p class="section-foot" data-testid="output-foot">{outputFoot}</p>{/if}
    {#if tx.tuneRefused}<p class="section-foot err" role="alert" data-testid="tune-refused">Tune did not start: {tx.tuneRefused}.</p>{/if}
    <p class="section-foot">{alcAdvice(rigConnected() ? settings.cat.radio : null)}</p>
  </div>

  <div class="section">
    <h2 class="section-head">Before you transmit</h2>
    <ul class="group">
      {#each checks as c (c.key)}
        <li class="row check">
          <label class="check-label">
            <input type="checkbox" class="box" checked={settings.checklist[c.key]} onchange={() => toggle(c.key)} />
            <span class="row-main">
              <span class="row-title">{c.title}</span>
              {#if c.sub}<span class="row-sub">{c.sub}</span>{/if}
            </span>
          </label>
        </li>
      {/each}
      <li class="row check">
        <span class="mark" class:ok={tx.keying?.passed === true} class:warn={tx.keying !== null && tx.keying.passed !== true} aria-hidden="true">
          <Icon name={tx.keying?.passed ? 'check' : 'alert'} size={20} />
        </span>
        <span class="row-main">
          <span class="row-title">Keying check</span>
          <span class="row-sub">{keyingText}</span>
        </span>
      </li>
    </ul>
  </div>

  <div class="section" bind:this={timingSection}>
    <h2 class="section-head">Timing</h2>
    <div class="group" data-testid="timing">
      <div class="row">
        <span class="row-main"><span class="row-title">Decoder</span></span>
        <span class="row-value" data-testid="decoder-status">{decoderText}</span>
      </div>
      <div class="row">
        <span class="row-main">
          <span class="row-title">Decode time</span>
          {#each timing.decodeTimes as d (d.mode)}
            <span class="row-sub" data-testid="timing-decode">{d.mode}: {Math.round(d.lastMs)} ms last, 95 % within {Math.round(d.p95Ms)} ms</span>
          {:else}
            <span class="row-sub" data-testid="timing-decode">Shows after the first slot</span>
          {/each}
        </span>
      </div>
      <div class="row">
        <span class="row-main"><span class="row-title">Slots not decoded</span><span class="row-sub" class:off={timing.skippedSlots > 0} data-testid="timing-skipped">{skippedText}</span></span>
      </div>
      <div class="row">
        <span class="row-main"><span class="row-title">{Device} clock</span><span class="row-sub" class:off={clockFoot !== null} data-testid="timing-clock">{clockRowText}</span></span>
      </div>
      <div class="row">
        <span class="row-main"><span class="row-title">Median DT</span><span class="row-sub" data-testid="timing-median">{medianText}</span></span>
      </div>
      <div class="row">
        <span class="row-main"><span class="row-title">Input offset</span><span class="row-sub" data-testid="timing-offset">{offsetText}</span></span>
      </div>
      <div class="row">
        <span class="row-main"><span class="row-title">Your Tx, heard back</span><span class="row-sub" data-testid="timing-heard">{heardText}</span></span>
      </div>
      <div class="row">
        <span class="row-main"><span class="row-title">Clock source</span><span class="row-sub" data-testid="timing-source">{sourceText}</span></span>
      </div>
      <div class="row">
        <span class="row-main"><span class="row-title">Clock drift</span><span class="row-sub" data-testid="timing-drift">{driftText}</span></span>
      </div>
      <div class="row">
        <span class="row-main"><span class="row-title">Capture lag</span><span class="row-sub" data-testid="timing-lag">{lagText}</span></span>
      </div>
      <div class="row">
        <span class="row-main"><span class="row-title">Audio gaps</span><span class="row-sub" data-testid="timing-gaps">{gapText}</span></span>
      </div>
      <div class="row">
        <span class="row-main">
          <span class="row-title">Resumes</span>
          {#if resumeLines.length}
            {#each resumeLines as line, i (i)}<span class="row-sub">{line}</span>{/each}
          {:else}
            <span class="row-sub">None since the app opened</span>
          {/if}
        </span>
      </div>
    </div>
    {#if clockFoot}<p class="section-foot" data-testid="timing-clock-foot">{clockFoot}</p>{/if}
    <div class="start">
      <button class="btn" onclick={() => void copyReport()}>Copy timing report</button>
      {#if copyState === 'copied'}<span class="copied" role="status">Copied</span>{/if}
    </div>
    {#if copyState === 'failed'}
      <p class="section-foot">{advice.copyRefused}</p>
      <textarea class="report" readonly aria-label="Timing report" value={reportText}></textarea>
    {/if}
    <p class="section-foot">Your Tx, heard back shows the timing of the transmit audio.</p>
  </div>
</section>

<TuneSheet bind:open={tuneOpen} dialHz={tuneDialHz} />

<style>
  .sub {
    padding-top: var(--rr-safe-top);
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

  .meter-row {
    display: block;
  }

  .copied {
    align-self: center;
    margin-left: var(--rr-space-3);
    color: var(--rr-label2);
    font-size: var(--rr-text-sub);
  }

  .report {
    width: 100%;
    min-height: 160px;
    margin-top: var(--rr-space-2);
    padding: var(--rr-space-2);
    border: 0;
    border-radius: var(--rr-radius-m);
    background: var(--rr-fill);
    color: var(--rr-label);
    font-family: var(--rr-mono);
    font-size: var(--rr-text-caption);
  }

  .start {
    display: flex;
    margin-top: var(--rr-space-3);
  }

  .slider {
    flex: 1;
    min-width: 0;
    height: var(--rr-tap);
    accent-color: var(--rr-accent-fill);
  }

  .pct {
    width: 52px;
  }

  /* The title, then the segments across the row. */
  .stack {
    flex-direction: column;
    gap: var(--rr-space-2);
    align-items: stretch;
  }

  /* Waterfall colours: each name over a strip of its colours. */
  .ramped {
    flex-direction: column;
    gap: var(--rr-space-1);
  }

  .ramp {
    width: 60%;
    height: var(--rr-space-1-5);
    border-radius: var(--rr-radius-pill);
  }

  .tune {
    color: var(--rr-label);
  }

  .acc {
    color: var(--rr-accent);
  }

  .check {
    align-items: flex-start;
  }

  /* The whole row is the tap target for its checkbox. */
  li.check:has(.check-label) {
    padding-top: 0;
    padding-bottom: 0;
  }

  .check-label {
    display: flex;
    flex: 1;
    gap: var(--rr-space-3);
    align-items: flex-start;
    min-height: var(--rr-tap);
    padding: var(--rr-space-2) 0;
    cursor: pointer;
  }

  .box {
    flex: none;
    width: 22px;
    height: 22px;
    margin: var(--rr-space-px) 0 0;
    accent-color: var(--rr-ok-bar);
  }

  .mark {
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    margin-top: var(--rr-space-px);
    color: var(--rr-label3);
  }

  .mark.ok {
    color: var(--rr-ok);
  }

  .mark.warn {
    color: var(--rr-warn);
  }

  .row-sub.off {
    color: var(--rr-warn);
  }

  .err {
    color: var(--rr-tx-text);
  }
</style>
