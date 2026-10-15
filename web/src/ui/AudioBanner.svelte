<script lang="ts">
  /**
   * What the audio is doing when it is not running, and the tap that starts or resumes it: one
   * slim strip under the top bar. Stopped in a QSO whose reports have gone both ways, it also
   * offers Log QSO, which logs the QSO as it stands (`logCall`, `onlog`).
   */
  import Icon from './Icon.svelte';
  import { utcTime } from '../lib/clock/format';
  import type { AudioStatus, StartError, StopReason } from '../lib/audio/engine';

  let {
    status,
    reason,
    error,
    stoppedAtUtcMs,
    onstart,
    onresume,
    logCall = null,
    onlog,
  }: {
    status: AudioStatus;
    reason: StopReason | null;
    error: StartError | null;
    stoppedAtUtcMs: number | null;
    onstart: () => void;
    onresume: () => void;
    /** The station of a QSO that can be logged as it stands; null for none. */
    logCall?: string | null;
    onlog?: () => void;
  } = $props();

  const STOPPED: Record<StopReason, string> = {
    interrupted: 'A call or another app took over the audio.',
    suspended: 'The browser paused the audio.',
    'input-ended': 'The audio input was disconnected.',
    'input-muted': 'The system muted the audio input.',
    hidden: 'RR73 left the screen, and iOS stops the microphone in the background.',
  };

  const FAILED: Record<StartError, string> = {
    insecure: 'The microphone needs a secure page. Open RR73 from its https address.',
    unsupported: 'This browser cannot capture audio. Open RR73 in Safari.',
    denied: 'RR73 has no microphone access. Allow the microphone for this site in Safari settings, then start audio again.',
    'no-device': 'No audio input was found. Connect the radio cable, then start audio again.',
    busy: 'Another app is using the microphone. Close it, then start audio again.',
    worklet: 'The audio processor did not load. Reload RR73, then start audio again.',
    unknown: 'Audio did not start. Start audio again.',
  };
</script>

{#if status === 'off'}
  <div class="banner off" role="status">
    <Icon name="mic" size={20} class="banner-icon" />
    <p class="text t">Audio is off</p>
    <button class="btn primary act" onclick={onstart}>Start audio</button>
  </div>
{:else if status !== 'running'}
  <div class="banner {status}" role="status">
    <Icon name={status === 'stopped' || status === 'failed' ? 'alert' : 'mic'} size={20} class="banner-icon" />
    <div class="text">
      {#if status === 'starting'}
        <p class="t">Starting audio</p>
        <p class="s">Allow the microphone if Safari asks.</p>
      {:else if status === 'stopped'}
        <p class="t">Audio stopped at {stoppedAtUtcMs === null ? 'an unknown time' : utcTime(stoppedAtUtcMs)}</p>
        <p class="s">{reason ? STOPPED[reason] : 'The audio stopped.'} Transmit is off.</p>
      {:else}
        <p class="t">Audio did not start</p>
        <p class="s">{error ? FAILED[error] : FAILED.unknown}</p>
      {/if}
    </div>
    {#if status === 'stopped'}
      <div class="acts">
        <button class="btn primary act" onclick={onresume}>Resume audio</button>
        {#if logCall && onlog}<button class="btn act log" aria-label="Log the QSO with {logCall}" onclick={onlog}>Log QSO</button>{/if}
      </div>
    {:else if status !== 'starting'}
      <button class="btn primary act" onclick={onstart}>Start audio</button>
    {/if}
  </div>
{/if}

<style>
  .banner {
    display: flex;
    flex: none;
    gap: var(--rr-space-2);
    align-items: center;
    margin: var(--rr-space-1) var(--rr-space-2);
    padding: var(--rr-space-1) var(--rr-space-1) var(--rr-space-1) var(--rr-space-3);
    border-radius: var(--rr-radius-l);
    background: var(--rr-accent-soft);
  }

  .banner.stopped,
  .banner.failed {
    background: var(--rr-tx-soft);
    box-shadow: inset 0 0 0 1px var(--rr-tx);
  }

  .banner :global(.banner-icon) {
    color: var(--rr-accent);
  }

  .banner.stopped :global(.banner-icon),
  .banner.failed :global(.banner-icon) {
    color: var(--rr-tx-text);
  }

  .text {
    flex: 1;
    min-width: 0;
  }

  .t {
    font-size: var(--rr-text-sub);
    font-weight: var(--rr-weight-semibold);
    line-height: var(--rr-leading-sub);
  }

  .stopped .t,
  .failed .t {
    color: var(--rr-tx-text);
  }

  .s {
    font-size: var(--rr-text-foot);
    line-height: var(--rr-leading-foot);
  }

  .acts {
    display: flex;
    flex: none;
    flex-direction: column;
    gap: var(--rr-space-1);
  }

  .act {
    flex: none;
    min-height: var(--rr-tap);
    padding: 0 var(--rr-space-3);
    border-radius: var(--rr-radius-m);
    font-size: var(--rr-text-sub);
  }
</style>
