<script lang="ts">
  /**
   * Send to Wavelog, at the top of the Log's All and To do views: what is true now ("4 QSOs not
   * sent to Wavelog"), the progress while sending ("Sending 2 of 4"), then the result, above one
   * full-width button. A full-width button in content, as iOS uses for a long action: "Send 4 QSOs
   * to Wavelog" is too long for a navigation bar button beside Add QSO and Export ADIF. Disabled,
   * with the reason under it, when Wavelog is not set up or the phone is offline.
   */
  import { href } from '../lib/app/router.svelte';
  import { utcHm } from '../lib/clock/format';
  import { log, sendToWavelog, unsentForWavelog } from '../lib/log/log.svelte';
  import { clock } from '../lib/state/now.svelte';

  const id = `send-reason-${Math.random().toString(36).slice(2, 8)}`;
  const w = $derived(log.wavelog);
  const count = $derived(unsentForWavelog().length);
  const notSent = $derived(log.ledger.filter((e) => e.destinationId === 'wavelog' && e.state === 'not-sent').length);
  const sync = $derived(log.sync);
  const status = $derived(log.outbox.wavelog);
  const qsos = (n: number) => `${n} ${n === 1 ? 'QSO' : 'QSOs'}`;
  const sending = $derived(`Sending ${Math.min(sync.done + 1, sync.total)} of ${sync.total}`);

  /** Why the button cannot send now, in plain words. */
  const reason = $derived.by(() => {
    if (!w.url || !w.apiKey) return 'Set up Wavelog in Settings › Logging to send QSOs.';
    if (!w.enabled) return 'Sending to Wavelog is off in Settings › Logging.';
    if (!w.stationId) return 'Run Test connection in Settings › Logging › Wavelog to choose a station location.';
    if (!log.online) return 'No connection. Send when the phone is online.';
    return null;
  });
  const setup = $derived(!w.url || !w.apiKey || !w.stationId);
  const recent = $derived(sync.summary && clock.ms - sync.summary.at < 120_000 ? sync.summary : null);

  /** What is true now: the run, its result, or what waits. */
  const text = $derived.by(() => {
    if (sync.running) return `${sending} to Wavelog.`;
    if (recent && !count) return recent.text;
    if (!count) return '';
    const before = recent ? `${recent.text} ` : '';
    if (notSent) return `${before}${qsos(notSent)} not sent to Wavelog.`;
    const next = status?.pausedUntil && status.pausedUntil > clock.ms ? ` Next try ${utcHm(status.pausedUntil)} UTC.` : '';
    return `${before}${qsos(count)} waiting for Wavelog.${next}`;
  });
</script>

{#if count || sync.running || text}
  <div class="section">
    <div class="bar" data-testid="send-bar">
      <p class="text" role="status">{text}</p>
      {#if reason && count}<p class="reason" {id}>{reason}</p>{/if}
      {#if count || sync.running}
        <button class="btn primary send" disabled={!!reason || sync.running} aria-describedby={reason ? id : undefined} onclick={() => void sendToWavelog()}>
          {sync.running ? sending : `Send ${qsos(count)} to Wavelog`}
        </button>
      {/if}
      {#if setup && count}<a class="text-button setup" href={href('settings', 'logging', 'wavelog')}>Set up Wavelog</a>{/if}
    </div>
  </div>
{/if}

<style>
  .bar {
    padding: var(--rr-space-3) var(--rr-space-4);
    border-radius: var(--rr-radius-xl);
    background: var(--rr-surface);
  }

  .text {
    font-size: var(--rr-text-sub);
    line-height: var(--rr-leading-sub);
  }

  .reason {
    margin-top: var(--rr-space-1);
    font-size: var(--rr-text-foot);
    line-height: var(--rr-leading-foot);
    color: var(--rr-tx-text);
  }

  .send {
    display: flex;
    width: 100%;
    margin-top: var(--rr-space-3);
  }

  .setup {
    display: flex;
    justify-content: center;
  }
</style>
