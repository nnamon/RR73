<script lang="ts">
  /** What the audio is doing when it is not running, and the tap that starts or resumes it. */
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
  }: {
    status: AudioStatus;
    reason: StopReason | null;
    error: StartError | null;
    stoppedAtUtcMs: number | null;
    onstart: () => void;
    onresume: () => void;
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

{#if status !== 'running'}
  <div class="banner {status}" role="status">
    <Icon name={status === 'stopped' || status === 'failed' ? 'alert' : 'mic'} size={22} class="banner-icon" />
    <div class="text">
      {#if status === 'off'}
        <p class="t">Audio is off</p>
        <p class="s">RR73 listens to the radio through the headset microphone contact.</p>
      {:else if status === 'starting'}
        <p class="t">Starting audio</p>
        <p class="s">Allow the microphone if Safari asks.</p>
      {:else if status === 'stopped'}
        <p class="t">Audio stopped at {stoppedAtUtcMs === null ? 'an unknown time' : utcTime(stoppedAtUtcMs)}</p>
        <p class="s">{reason ? STOPPED[reason] : 'The audio stopped.'} Transmit is off.</p>
      {:else}
        <p class="t">Audio did not start</p>
        <p class="s">{error ? FAILED[error] : FAILED.unknown}</p>
      {/if}
      {#if status === 'stopped'}
        <button class="btn primary" onclick={onresume}>Resume audio</button>
      {:else if status !== 'starting'}
        <button class="btn primary" onclick={onstart}>Start audio</button>
      {/if}
    </div>
  </div>
{/if}

<style>
  .banner {
    display: flex;
    flex: none;
    gap: var(--rr-space-2);
    margin: var(--rr-space-half) var(--rr-space-4) var(--rr-space-2);
    padding: var(--rr-space-3) var(--rr-space-4);
    border-radius: var(--rr-radius-xl);
    background: var(--rr-accent-soft);
  }

  .banner.stopped,
  .banner.failed {
    background: var(--rr-tx-soft);
    box-shadow: inset 0 0 0 1px var(--rr-tx);
  }

  .banner :global(.banner-icon) {
    margin-top: var(--rr-space-px);
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
    font-size: var(--rr-text-body);
    font-weight: var(--rr-weight-bold);
    line-height: var(--rr-leading-body);
    letter-spacing: -0.026em;
  }

  .stopped .t,
  .failed .t {
    color: var(--rr-tx-text);
  }

  .s {
    margin-top: var(--rr-space-half);
    font-size: var(--rr-text-sub);
    line-height: var(--rr-leading-sub);
    letter-spacing: -0.015em;
  }

  .btn {
    width: 100%;
    margin-top: var(--rr-space-3);
  }
</style>
