<script lang="ts">
  /**
   * Operate: one frame for every mode. The top bar, the audio banner and the waterfall stay; the
   * mode's pane (operate/panes.ts) brings the middle of the screen and its controls, with Halt.
   *
   * In compact width the frame is one column, as on the phone. In compact height (a phone on its
   * side) the middle takes the left and the full height, with the waterfall above the controls
   * on the right. In regular width the waterfall runs across at a third of the height, over the
   * middle and the transmit panel on the right, or over a bottom bar in a window taller than
   * wide. The top bar moves to the app in regular width, above every screen.
   */
  import ActivationChip from '../ui/ActivationChip.svelte';
  import AudioBanner from '../ui/AudioBanner.svelte';
  import StationBar from '../ui/StationBar.svelte';
  import Waterfall from '../ui/Waterfall.svelte';
  import { PANES, familyOf } from './operate/panes';
  import { qso, setFrequencies } from '../lib/state/qso.svelte';
  import { layout } from '../lib/app/layout.svelte';
  import { markedTxHz } from '../lib/qso/view';
  import { settings } from '../lib/state/settings.svelte';
  import { audio, resumeAudio, startAudio, tx } from '../lib/state/station.svelte';
  import { setWsprTxHz, wspr } from '../lib/state/wspr.svelte';
  import { keyboard, session, settle, tapToTune, tuneMark } from '../lib/state/keyboard.svelte';
  import { spaceHz } from '../lib/rtty/settings';

  /** False while another screen is pushed over Operate: the list keeps its place for the return. */
  let { active = true }: { active?: boolean } = $props();

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
</script>

<section class="operate {layout.size}" class:upright={layout.upright} aria-labelledby="operate-title">
  <h1 id="operate-title" class="visually-hidden">Operate</h1>
  {#if layout.size !== 'regular'}<StationBar />{/if}
  <div class="notes" data-part="notes">
    <ActivationChip />

    <AudioBanner
      status={audio.status}
      reason={audio.reason}
      error={audio.error}
      stoppedAtUtcMs={audio.stoppedAtUtcMs}
      onstart={() => void startAudio()}
      onresume={() => void resumeAudio()}
    />
  </div>

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

  /* The phone: one column, the pane's parts in the frame's own flow. */
  .notes,
  .compact > :global([data-part]) {
    display: contents;
  }

  /*
   * A phone on its side: the middle on the left at full height; the waterfall and the controls in
   * a column on the right. Panes that bring no parts of their own fill the frame below the bar.
   */
  .compact-height {
    --rr-waterfall: var(--rr-side-waterfall);

    display: grid;
    grid-template:
      'top top' auto
      'notes notes' auto
      'middle wf' auto
      'middle controls' minmax(0, 1fr)
      / minmax(0, 1fr) calc(var(--rr-side) + var(--rr-safe-right));
    overflow: hidden;
  }

  .compact-height > :global(.top) {
    grid-area: top;
  }

  .compact-height > :global(.wf-wrap) {
    grid-area: wf;
    padding-right: var(--rr-safe-right);
    background: var(--rr-dock);
  }

  /*
   * Regular width: the waterfall across at a third of the height, the middle and the transmit
   * panel under it; upright, the controls along the bottom. On its side, the waterfall gives way
   * down to a quarter of the height where the panel would not show Tx1 to Tx6 and Halt whole.
   */
  .regular {
    --rr-waterfall: clamp(25dvh, 100dvh - var(--rr-safe-top) - var(--rr-top-regular) - var(--rr-panel-tall), 100dvh / 3);

    display: grid;
    grid-template:
      'notes notes' auto
      'wf wf' auto
      'middle controls' minmax(0, 1fr)
      / minmax(0, 1fr) var(--rr-panel);
    overflow: hidden;
    padding-top: 0;
  }

  .regular.upright {
    --rr-waterfall: calc(100dvh / 3);

    grid-template:
      'notes' auto
      'wf' auto
      'middle' minmax(0, 1fr)
      'controls' auto
      / minmax(0, 1fr);
  }

  .regular > :global(.wf-wrap) {
    grid-area: wf;
  }

  .notes {
    grid-area: notes;
  }

  .compact-height > .notes,
  .regular > .notes {
    display: block;
  }

  .compact-height > :global([data-part='middle']),
  .regular > :global([data-part='middle']) {
    display: flex;
    grid-area: middle;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }

  .compact-height > :global([data-part='controls']),
  .regular > :global([data-part='controls']) {
    display: flex;
    grid-area: controls;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }

</style>
