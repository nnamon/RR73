<script lang="ts">
  /**
   * Operate: one frame for every mode. The top bar, the audio banner and the waterfall stay; the
   * mode's pane (operate/panes.ts) fills the middle and brings its bottom bar, with Halt.
   */
  import ActivationChip from '../ui/ActivationChip.svelte';
  import AudioBanner from '../ui/AudioBanner.svelte';
  import BandSheet from '../ui/BandSheet.svelte';
  import TopBar from '../ui/TopBar.svelte';
  import Waterfall from '../ui/Waterfall.svelte';
  import { PANES, familyOf } from './operate/panes';
  import { houndOn, qso, setFrequencies } from '../lib/state/qso.svelte';
  import { utcTime } from '../lib/clock/format';
  import { hasSlots, slotProgress } from '../lib/clock/slots';
  import { dialHz } from '../lib/radio/bands';
  import { operatingDialHz } from '../lib/radio/hound-dial';
  import { markedTxHz } from '../lib/qso/view';
  import { spotsShown } from '../lib/state/features.svelte';
  import { clock } from '../lib/state/now.svelte';
  import { settings } from '../lib/state/settings.svelte';
  import { practice } from '../lib/state/practice.svelte';
  import { audio, resumeAudio, startAudio, tx } from '../lib/state/station.svelte';
  import { setWsprTxHz, wspr } from '../lib/state/wspr.svelte';
  import { currentDialHz, keyboard, session, settle, tapToTune, tuneMark } from '../lib/state/keyboard.svelte';
  import { dial4 } from '../lib/rtty/dial';
  import { spaceHz } from '../lib/rtty/settings';

  /** False while another screen is pushed over Operate: the list keeps its place for the return. */
  let { active = true }: { active?: boolean } = $props();

  let bandOpen = $state(false);
  let wf = $state<ReturnType<typeof Waterfall>>();

  const family = $derived(familyOf(settings.mode));
  const Pane = $derived(PANES[family]);
  const isWspr = $derived(family === 'wspr');
  const isKeyboard = $derived(family === 'keyboard');

  // A selected spot's trace is marked on the waterfall.
  const selectedHz = $derived.by(() => {
    const id = wspr.selected;
    if (!isWspr || !id) return null;
    for (const s of wspr.slots) for (const p of s.spots) if (p.id === id) return p.audioHz;
    return null;
  });

  const live = $derived(audio.status === 'running');
  const onAir = $derived(isWspr ? !!wspr.onAir : isKeyboard ? session.tx !== 'off' : !!qso.onAir);
  const transmitting = $derived(onAir || tx.tuning);
  const stateText = $derived(
    onAir
      ? 'Transmitting'
      : tx.tuning
        ? 'Tuning'
        : live
          ? 'Receiving'
          : audio.status === 'starting'
            ? 'Starting audio'
            : audio.status === 'stopped'
              ? 'Audio stopped'
              : 'Audio off',
  );
</script>

<section class="operate" aria-labelledby="operate-title">
  <h1 id="operate-title" class="visually-hidden">Operate</h1>
  <TopBar
    band={settings.band}
    mode={houndOn() ? `${settings.mode} Hound` : settings.mode}
    dialHz={isWspr ? dialHz(settings.band, 'WSPR') : isKeyboard ? currentDialHz() : operatingDialHz(settings.band, settings.mode, houndOn(), settings.houndDialHz)}
    dialText={isKeyboard ? dial4(currentDialHz()) : undefined}
    utc={utcTime(clock.ms)}
    progress={hasSlots(settings.mode) ? slotProgress(clock.ms, settings.mode) : null}
    tone={transmitting ? 'tx' : live ? 'rx' : 'idle'}
    state={stateText}
    onair={transmitting}
    rmsDb={audio.rmsDb}
    {live}
    spots={spotsShown()}
    practice={practice.on}
    onband={() => (bandOpen = true)}
  />
  <ActivationChip />

  <AudioBanner
    status={audio.status}
    reason={audio.reason}
    error={audio.error}
    stoppedAtUtcMs={audio.stoppedAtUtcMs}
    onstart={() => void startAudio()}
    onresume={() => void resumeAudio()}
  />

  {#if isWspr}
    <Waterfall
      bind:this={wf}
      mode="WSPR"
      rxHz={null}
      txHz={settings.wspr.txHz}
      markHz={selectedHz}
      txSlots={tx.slots}
      contrast={settings.waterfallContrast}
      stoppedAtUtcMs={audio.status === 'stopped' ? audio.stoppedAtUtcMs : null}
      hint={!settings.freqPicked}
      onset={(f) => f.txHz !== undefined && setWsprTxHz(f.txHz)}
    />
  {:else if isKeyboard}
    <Waterfall
      bind:this={wf}
      mode="RTTY"
      rxHz={null}
      txHz={0}
      contrast={settings.waterfallContrast}
      stoppedAtUtcMs={audio.status === 'stopped' ? audio.stoppedAtUtcMs : null}
      hint={!live}
      onset={() => undefined}
      pair={{ markHz: keyboard.markHz, spaceHz: spaceHz(settings.rtty, keyboard.markHz), air: session.tx !== 'off' }}
      strip={keyboard.keyboardUp}
      ontune={(mark, done) => {
        tuneMark(mark);
        if (done) settle();
      }}
      onfind={tapToTune}
    />
  {:else}
    <Waterfall
      bind:this={wf}
      mode={settings.mode}
      rxHz={settings.rxHz}
      txHz={markedTxHz(qso.st, settings.txHz)}
      txSlots={tx.slots}
      contrast={settings.waterfallContrast}
      stoppedAtUtcMs={audio.status === 'stopped' ? audio.stoppedAtUtcMs : null}
      hint={!settings.freqPicked}
      onset={setFrequencies}
    />
  {/if}

  <Pane {active} waterfall={wf} />
</section>

<BandSheet bind:open={bandOpen} />

<style>
  /* On short screens with a banner, Operate scrolls; the bottom bar stays at the bottom, so Halt
     never leaves the screen. */
  .operate {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding-top: var(--rr-safe-top);

    /* The status bar's inset takes the top bar's material. */
    background: linear-gradient(var(--rr-dock), var(--rr-dock)) top / 100% var(--rr-safe-top) no-repeat, var(--rr-plain);
  }

</style>
