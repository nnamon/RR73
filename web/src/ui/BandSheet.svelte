<script lang="ts">
  /** Change band. RR73 cannot read the radio's dial, so the operator sets it and confirms here. */
  import Sheet from './Sheet.svelte';
  import { BAND_IDS, dialHz, type BandId } from '../lib/radio/bands';
  import type { Mode } from '../lib/clock/slots';
  import { mhz } from '../lib/clock/format';
  import { settings, updateSettings } from '../lib/state/settings.svelte';

  let { open = $bindable(false) }: { open: boolean } = $props();

  let band = $state<BandId>(settings.band);
  let mode = $state<Mode>(settings.mode);

  $effect(() => {
    if (open) {
      band = settings.band;
      mode = settings.mode;
    }
  });

  // FT4 has no usual frequency on 160m and 60m.
  $effect(() => {
    if (dialHz(band, mode) === null) mode = 'FT8';
  });

  const dial = $derived(dialHz(band, mode));

  function confirm() {
    void updateSettings({ band, mode });
    open = false;
  }
</script>

<Sheet bind:open title="Change band">
  <fieldset class="bands">
    <legend class="visually-hidden">Band</legend>
    {#each BAND_IDS as b (b)}
      <label class="tile" class:on={band === b}>
        <input class="visually-hidden" type="radio" name="band" value={b} bind:group={band} />
        {b}
      </label>
    {/each}
  </fieldset>
  <fieldset class="seg">
    <legend class="visually-hidden">Mode</legend>
    {#each ['FT8', 'FT4'] as const as m (m)}
      <label class="seg-i" class:on={mode === m} class:off={dialHz(band, m) === null}>
        <input class="visually-hidden" type="radio" name="mode" value={m} bind:group={mode} disabled={dialHz(band, m) === null} />
        {m}
      </label>
    {/each}
  </fieldset>
  <div class="setblock">
    <p class="k">Set the radio to</p>
    <p class="f mono">{dial === null ? '' : mhz(dial)}</p>
    <p class="m">USB</p>
  </div>
  <p class="note">RR73 can’t read the radio’s dial. Saved slots record the band you confirm here.</p>
  <button class="btn primary confirm" onclick={confirm}>Use {band} {mode}</button>
  <button class="btn cancel" onclick={() => (open = false)}>Cancel</button>
</Sheet>

<style>
  fieldset {
    margin: 0;
    padding: 0;
    border: 0;
  }

  .bands {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: var(--rr-space-2);
    margin-top: var(--rr-space-3);
  }

  .tile {
    display: flex;
    align-items: center;
    justify-content: center;
    height: var(--rr-tap);
    border-radius: var(--rr-radius-l);
    background: var(--rr-sheet-card);
    font-size: var(--rr-text-body);
    font-weight: var(--rr-weight-semibold);
    letter-spacing: -0.02em;
    cursor: pointer;
  }

  .tile.on {
    background: var(--rr-accent-fill);
    color: var(--rr-on-fill);
  }

  .tile:has(:focus-visible) {
    outline: 2px solid var(--rr-accent);
    outline-offset: 2px;
  }

  .seg {
    margin-top: var(--rr-space-3);
  }

  .seg-i.off {
    color: var(--rr-label3);
    cursor: default;
  }

  .setblock {
    margin-top: var(--rr-space-4);
    padding: var(--rr-space-3) var(--rr-space-4) var(--rr-space-4);
    border-radius: var(--rr-radius-xl);
    background: var(--rr-sheet-card);
  }

  .k {
    font-size: var(--rr-text-sub);
    line-height: var(--rr-leading-sub);
    color: var(--rr-label2);
  }

  .f {
    margin-top: var(--rr-space-half);
    font-size: var(--rr-text-dial);
    font-weight: var(--rr-weight-bold);
    line-height: var(--rr-leading-dial);
    letter-spacing: -0.02em;
    white-space: nowrap;
  }

  .m {
    font-size: var(--rr-text-sideband);
    font-weight: var(--rr-weight-semibold);
    line-height: var(--rr-leading-title);
  }

  .note {
    margin: var(--rr-space-3) var(--rr-space-1) 0;
    font-size: var(--rr-text-foot);
    line-height: var(--rr-leading-row);
    color: var(--rr-label2);
  }

  .confirm,
  .cancel {
    width: 100%;
    margin-top: var(--rr-space-3);
  }

  .cancel {
    margin-top: var(--rr-space-2);
    background: transparent;
    color: var(--rr-accent);
  }
</style>
