<script lang="ts">
  /** Progress through the current slot, as in the mockups: blue receiving, red transmitting, grey idle. */
  let { progress, tone = 'rx' }: { progress: number; tone?: 'rx' | 'tx' | 'idle' } = $props();
  const r = 12.5;
  const c = 2 * Math.PI * r;
  const dash = $derived(`${(c * Math.max(0, Math.min(1, progress))).toFixed(2)} ${c.toFixed(2)}`);
</script>

<svg class="ring {tone}" viewBox="0 0 30 30" aria-hidden="true">
  <circle class="track" cx="15" cy="15" {r} />
  <circle class="value" cx="15" cy="15" {r} stroke-dasharray={dash} transform="rotate(-90 15 15)" />
</svg>

<style>
  .ring {
    flex: none;
    width: var(--rr-ring);
    height: var(--rr-ring);
  }

  circle {
    fill: none;
    stroke-width: 3;
  }

  .track {
    stroke: var(--rr-fill2);
  }

  .value {
    stroke: var(--rr-accent);
    stroke-linecap: round;
  }

  .tx .value {
    stroke: var(--rr-tx);
  }

  .idle .value {
    stroke: var(--rr-label3);
  }
</style>
