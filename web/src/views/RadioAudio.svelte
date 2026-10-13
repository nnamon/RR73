<script lang="ts">
  import { onDestroy } from 'svelte';
  import BackLink from '../ui/BackLink.svelte';
  import Icon from '../ui/Icon.svelte';
  import LevelMeter from '../ui/LevelMeter.svelte';
  import TuneSheet from '../ui/TuneSheet.svelte';
  import { href } from '../lib/app/router.svelte';
  import { signed, utcHm, utcTime } from '../lib/clock/format';
  import { timingReport, type TimingSnapshot } from '../lib/clock/timing';
  import { dialHz } from '../lib/radio/bands';
  import type { Applied } from '../lib/audio/report';
  import type { Contrast } from '../lib/waterfall/levels';
  import { settings, updateSettings, type Checklist } from '../lib/state/settings.svelte';
  import { audio, halt, inputDevices, startAudio, startTune, timingSnapshot, tx, useInput } from '../lib/state/station.svelte';

  let devices = $state<MediaDeviceInfo[]>([]);
  let tuneOpen = $state(false);
  const live = $derived(audio.status === 'running');
  const r = $derived(audio.report);

  // Device labels are readable only after microphone permission, so list again once audio runs.
  $effect(() => {
    void audio.status;
    void inputDevices().then((d) => (devices = d));
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
  const screenText = $derived(
    audio.wake === 'held' ? 'Stays on while audio runs' : audio.wake === 'refused' ? 'Follows Auto-Lock: the browser refused to keep it on' : audio.wake === 'unsupported' ? 'Follows Auto-Lock: this browser cannot keep it on' : 'Stays on while audio runs',
  );

  const CONTRASTS: { id: Contrast; label: string }[] = [
    { id: 'low', label: 'Low' },
    { id: 'normal', label: 'Normal' },
    { id: 'high', label: 'High' },
  ];

  const checks: { key: keyof Checklist; title: string; sub: string }[] = [
    { key: 'focus', title: 'Focus mode on', sub: 'iOS sounds go out through the cable and key the radio’s VOX.' },
    { key: 'clicks', title: 'Keyboard clicks off', sub: 'RR73 can’t see this setting.' },
    { key: 'volume', title: 'Phone volume at maximum', sub: 'It sets the transmit level.' },
  ];

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
    timing.medianDtS === null ? 'Shows once decodes at −10 dB or stronger arrive' : `${secs(timing.medianDtS)} from ${timing.strongDecodes} decodes at −10 dB or stronger`,
  );
  const offsetText = $derived(timing.inputOffsetS === 0 ? 'None. It is set from the median DT once 8 decodes are in.' : `${secs(timing.inputOffsetS)} on receive audio`);
  const sourceText = $derived(
    timing.source === 'output' ? 'Output timestamps' : timing.source === 'current-time' ? 'Audio clock time: the output timestamps are unusable' : 'Unknown until audio starts',
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
        : `${timing.gaps} ${timing.gaps === 1 ? 'gap' : 'gaps'}, ${Math.round(timing.gapMs)} ms in total. Receive timing stays on the audio clock across them.`,
  );
  const lagText = $derived(timing.captureLagMs === null ? 'Unknown until audio starts' : `${Math.round(timing.captureLagMs)} ms`);
  const heardText = $derived.by(() => {
    const h = timing.heardBack;
    if (!h.length) return 'Shows after RR73 transmits';
    const last = h.find((x) => x.dtS !== null);
    if (!last) return `Not heard back. The radio returned no decodable signal in the last ${h.length === 1 ? 'transmission' : `${h.length} transmissions`}.`;
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
    void updateSettings({ inputDeviceId: id });
    void useInput(id);
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
      <p class="section-foot">Once audio runs, these rows show what the browser applied to the microphone.</p>
    {:else}
      <p class="section-foot">Peak {signed(Math.round(audio.peakDb))} dBFS. Aim for band noise inside the green zone with the radio’s AGC on.</p>
    {/if}
  </div>

  <div class="section">
    <h2 class="section-head">Transmit audio</h2>
    <div class="group">
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
            <span class="row-sub">Start audio plays a short rising chime (659 and 880 Hz, 0.45 s) at the output level. The chime keys the radio and runs the keying check. It also stops iOS muting output on the silent switch.</span>
          </span>
        </label>
      </div>
      <button
        class="row tune"
        onclick={() => {
          startTune();
          tuneOpen = true;
        }}
      >
        <span class="row-main">
          <span class="row-title acc">Tune for 10 s</span>
          <span class="row-sub">Transmits at {settings.txHz} Hz for 10 s with a countdown. Halt stops it.</span>
        </span>
      </button>
    </div>
    <p class="section-foot">Raise the level until the radio shows 4 to 5 ALC bars during Tune. Above 5 bars the signal distorts.</p>
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
              <span class="row-sub">{c.sub}</span>
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
          <span class="row-sub">
            {#if tx.keying === null}
              Not checked yet. Start audio with the start chime on, or run Tune. The check passes when receive audio drops as the radio keys.
            {:else if tx.keying.passed === null && tx.keying.source === 'tune'}
              Not checked at {utcHm(tx.keying.atUtcMs)}: receive audio was off during Tune. Start audio, then run Tune again.
            {:else if tx.keying.passed === null}
              Not checked at {utcHm(tx.keying.atUtcMs)}: receive audio had not started when the start chime played. Start audio again.
            {:else if tx.keying.passed}
              Passed at {utcHm(tx.keying.atUtcMs)}. Receive audio dropped {Math.round(tx.keying.dropDb ?? 0)} dB during {tx.keying.source === 'start' ? 'the start chime' : 'Tune'}, so the radio keyed.
            {:else}
              Failed at {utcHm(tx.keying.atUtcMs)}. Receive audio did not drop during {tx.keying.source === 'start' ? 'the start chime' : 'Tune'}. Check the radio’s VOX setting and the cable.
            {/if}
          </span>
        </span>
      </li>
    </ul>
  </div>

  <div class="section">
    <h2 class="section-head">Timing</h2>
    <div class="group" data-testid="timing">
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
    <div class="start">
      <button class="btn" onclick={() => void copyReport()}>Copy timing report</button>
      {#if copyState === 'copied'}<span class="copied" role="status">Copied</span>{/if}
    </div>
    {#if copyState === 'failed'}
      <p class="section-foot">The phone refused to copy. Select the report below and copy it.</p>
      <textarea class="report" readonly aria-label="Timing report" value={reportText}></textarea>
    {/if}
    <p class="section-foot">
      DT reads about 0 s for stations with correct clocks. The input offset moves receive audio toward a median DT of 0, by at most 0.08 s per slot. Transmit timing does not use it. Your Tx, heard back
      decodes your own transmission when the radio returns it to the phone, and measures transmit timing directly.
    </p>
  </div>
</section>

<TuneSheet bind:open={tuneOpen} dialHz={dialHz(settings.band, settings.mode)} />

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
</style>
