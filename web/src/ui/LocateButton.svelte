<script lang="ts">
  /** Use GPS: sets a grid from the phone's position. Used by Settings and the activation form. */
  import Icon from './Icon.svelte';
  import { locateGrid, type LocateResult } from '../lib/location/locate';

  let { chars = 6, onresult }: { chars?: 4 | 6 | 8; onresult: (r: LocateResult) => void } = $props();

  let finding = $state(false);

  // getCurrentPosition runs inside the tap, where iOS expects the first permission prompt.
  async function locate() {
    finding = true;
    try {
      onresult(await locateGrid(chars));
    } finally {
      finding = false;
    }
  }
</script>

<button type="button" class="btn compact soft gps" disabled={finding} onclick={locate}>
  <Icon name="locate" size={18} /><span>{finding ? 'Finding' : 'Use GPS'}</span>
</button>

<style>
  /* The tinted fill is too light for its text on sheet cards in dark mode; this fill works on every card. */
  .soft {
    background: var(--rr-fill2);
    color: var(--rr-accent);
  }

  .gps {
    flex: none;
    gap: var(--rr-space-1);
    padding: 0 var(--rr-space-2);
  }
</style>
