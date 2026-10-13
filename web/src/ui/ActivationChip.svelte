<script lang="ts">
  /**
   * One line on Operate while an activation runs: the first reference's progress and the time
   * left in the UTC day. It opens Spots, where the activation lives.
   */
  import { href } from '../lib/app/router.svelte';
  import { hoursMinutes, progress, utcDayLeftMs, utcDayStart } from '../lib/log/activation';
  import { log } from '../lib/log/log.svelte';
  import { clock } from '../lib/state/now.svelte';

  // Progress counts by UTC day, so it recounts when the day or the log changes, not with Operate's 5 Hz clock.
  const day = $derived(utcDayStart(clock.ms));
  const a = $derived(log.current);
  const p = $derived.by(() => {
    if (!a) return null;
    const all = progress(a, log.qsos, log.activations, day);
    return all.find((x) => x.target !== null) ?? all[0] ?? null;
  });
  const status = $derived(p ? (p.qualified ? 'Qualified' : p.target ? `${p.count} of ${p.target}` : p.label) : '');
  const more = $derived(a && a.refs.length > 1 ? ` +${a.refs.length - 1}` : '');
  const left = $derived(hoursMinutes(utcDayLeftMs(clock.ms)));
</script>

{#if a && p}
  <a class="strip" href={href('spots')} aria-label="Activation {p.programme} {p.ref}{more}, {status}. UTC day ends in {left}. Open the activation in Spots.">
    <span class="chip">{p.programme} {p.ref}{more} · {status}</span>
    <span class="day">UTC day {left} left</span>
  </a>
{/if}

<style>
  .strip {
    display: flex;
    flex: none;
    gap: var(--rr-space-2);
    align-items: center;
    min-height: var(--rr-tap);
    padding: 0 calc(var(--rr-space-4) + var(--rr-safe-right)) 0 calc(var(--rr-space-4) + var(--rr-safe-left));
    color: var(--rr-label2);
  }

  .chip {
    flex: none;
    padding: var(--rr-space-half) var(--rr-space-2);
    border-radius: var(--rr-radius-pill);
    background: var(--rr-ok-soft);
    color: var(--rr-ok);
    font-size: var(--rr-text-foot);
    font-weight: var(--rr-weight-semibold);
    line-height: var(--rr-leading-foot);
    white-space: nowrap;
  }

  .day {
    min-width: 0;
    overflow: hidden;
    font-size: var(--rr-text-foot);
    line-height: var(--rr-leading-foot);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
