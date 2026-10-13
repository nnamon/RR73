<script lang="ts">
  import { onDestroy } from 'svelte';
  import BackLink from '../ui/BackLink.svelte';
  import Icon from '../ui/Icon.svelte';
  import LevelMeter from '../ui/LevelMeter.svelte';
  import TuneSheet from '../ui/TuneSheet.svelte';
  import { href } from '../lib/app/router.svelte';
  import { signed, utcHm } from '../lib/clock/format';
  import { dialHz } from '../lib/radio/bands';
  import type { Applied } from '../lib/audio/report';
  import { settings, updateSettings, type Checklist } from '../lib/state/settings.svelte';
  import { audio, halt, inputDevices, startAudio, tx, useInput } from '../lib/state/station.svelte';

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
    audio.wake === 'held' ? 'Stays on while audio runs' : audio.wake === 'refused' ? 'Can lock: the browser refused to keep it on' : audio.wake === 'unsupported' ? 'Can lock: this browser cannot keep it on' : 'Stays on while audio runs',
  );

  const checks: { key: keyof Checklist; title: string; sub: string }[] = [
    { key: 'focus', title: 'Focus mode on', sub: 'iOS sounds go out through the cable and key the radio’s VOX.' },
    { key: 'clicks', title: 'Keyboard clicks off', sub: 'RR73 can’t see this setting.' },
    { key: 'volume', title: 'Phone volume at maximum', sub: 'It sets the transmit level.' },
  ];

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
            <span class="row-title">Start tone</span>
            <span class="row-sub">Start audio plays 1500 Hz for 0.4 s at the output level. It keys the radio, runs the keying check, and stops iOS muting output on the silent switch.</span>
          </span>
        </label>
      </div>
      <button class="row tune" onclick={() => (tuneOpen = true)}>
        <span class="row-main">
          <span class="row-title acc">Tune…</span>
          <span class="row-sub">Asks first, then transmits at {settings.txHz} Hz for 10 s with a countdown.</span>
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
              Not checked yet. Start audio with the start tone on, or run Tune: receive audio drops when the radio keys.
            {:else if tx.keying.passed === null && tx.keying.source === 'tune'}
              Not checked at {utcHm(tx.keying.atUtcMs)}: receive audio was off during Tune. Start audio, then run Tune again.
            {:else if tx.keying.passed === null}
              Not checked at {utcHm(tx.keying.atUtcMs)}: receive audio had not started when the start tone played. Start audio again.
            {:else if tx.keying.passed}
              Passed at {utcHm(tx.keying.atUtcMs)}. Receive audio dropped {Math.round(tx.keying.dropDb ?? 0)} dB during {tx.keying.source === 'start' ? 'the start tone' : 'Tune'}, so the radio keyed.
            {:else}
              Failed at {utcHm(tx.keying.atUtcMs)}. Receive audio did not drop during {tx.keying.source === 'start' ? 'the start tone' : 'Tune'}. Check the radio’s VOX setting and the cable.
            {/if}
          </span>
        </span>
      </li>
    </ul>
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
