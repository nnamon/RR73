<script lang="ts">
  /**
   * Change band. RR73 cannot read the radio's dial, so the operator chooses the band here and
   * sets the radio to the frequency shown. A tap on a band applies it and closes the sheet; a tap
   * on a mode applies it and keeps the sheet open. Tx keeps its state across a band change.
   * With Hound on, the sheet takes the DXpedition's dial frequency for the band, stored per band.
   * WSPR takes WSPRnet's dial on every band; 2m has WSPR only, so its tile is off in FT8 and FT4.
   * RTTY has no calling frequency: the sheet takes the dial, in MHz or kHz, kept per band, and
   * opens with that field focused, so a retune takes a few digits.
   */
  import { tick } from 'svelte';
  import Sheet from './Sheet.svelte';
  import { BAND_IDS, dialHz, type BandId } from '../lib/radio/bands';
  import { MODES, type Mode } from '../lib/clock/slots';
  import { mhz } from '../lib/clock/format';
  import { settings, updateSettings } from '../lib/state/settings.svelte';
  import { setHound, setHoundDial } from '../lib/state/qso.svelte';
  import { operatingDialHz, parseDialMhz } from '../lib/radio/hound-dial';
  import { dial4, parseRttyDial, rttyDialHz } from '../lib/rtty/dial';
  import { setRtty } from '../lib/state/keyboard.svelte';

  let { open = $bindable(false) }: { open: boolean } = $props();

  let band = $state<BandId>(settings.band);
  let mode = $state<Mode>(settings.mode);

  $effect(() => {
    if (open) {
      band = settings.band;
      mode = settings.mode;
    }
  });

  const hound = $derived(settings.houndBands.includes(band));
  const dial = $derived(operatingDialHz(band, mode, hound, settings.houndDialHz));

  // The DXpedition's dial frequency, as typed; it starts at the stored value or the band's FT8 frequency.
  let dialText = $state('');
  let dialError = $state<string | null>(null);
  $effect(() => {
    if (!hound || mode !== 'FT8') return;
    dialText = ((settings.houndDialHz[band] ?? dialHz(band, 'FT8') ?? 0) / 1e6).toFixed(3);
    dialError = null;
  });

  // RTTY's dial, as typed; it follows the band chosen.
  let rttyText = $state('');
  let rttyError = $state<string | null>(null);
  let rttyField: HTMLInputElement | undefined = $state();
  $effect(() => {
    if (mode !== 'RTTY') return;
    const hz = rttyDialHz(band, settings.rtty.dialHz);
    rttyText = hz === null ? '' : dial4(hz);
    rttyError = null;
  });
  $effect(() => {
    if (!open || mode !== 'RTTY') return;
    void tick().then(() => {
      rttyField?.focus({ preventScroll: true });
      rttyField?.select();
    });
  });

  function saveRttyDial() {
    const r = parseRttyDial(rttyText, band);
    if ('error' in r) {
      rttyError = r.error;
      return;
    }
    rttyError = null;
    rttyText = dial4(r.hz);
    if (r.hz !== rttyDialHz(band, settings.rtty.dialHz)) setRtty({ dialHz: { ...settings.rtty.dialHz, [band]: r.hz } });
  }

  function saveDial() {
    const r = parseDialMhz(dialText, band);
    if ('error' in r) {
      dialError = r.error;
      return;
    }
    dialError = null;
    setHoundDial(band, r.hz);
  }

  /** The mode after choosing band `b`: the same, or FT8 where FT4 has no usual frequency (160m, 60m); null where the mode has none. */
  function modeOn(b: BandId, m: Mode): Mode | null {
    if (dialHz(b, m) !== null) return m;
    return m === 'FT4' && dialHz(b, 'FT8') !== null ? 'FT8' : null;
  }

  function chooseBand(b: BandId) {
    const m = modeOn(b, mode);
    if (!m) return;
    band = b;
    mode = m;
    void updateSettings({ band, mode });
    open = false;
  }

  function chooseMode(m: Mode) {
    mode = m;
    void updateSettings({ band, mode });
  }
</script>

<Sheet bind:open title="Change band">
  <fieldset class="bands">
    <legend class="visually-hidden">Band</legend>
    {#each BAND_IDS as b (b)}
      <label class="tile" class:on={band === b} class:off={!modeOn(b, mode)}>
        <input class="visually-hidden" type="radio" name="band" value={b} checked={band === b} disabled={!modeOn(b, mode)} onclick={() => chooseBand(b)} />
        {b}
      </label>
    {/each}
  </fieldset>
  <fieldset class="seg">
    <legend class="visually-hidden">Mode</legend>
    {#each MODES as m (m)}
      <label class="seg-i" class:on={mode === m} class:off={dialHz(band, m) === null}>
        <input class="visually-hidden" type="radio" name="mode" value={m} checked={mode === m} disabled={dialHz(band, m) === null} onchange={() => chooseMode(m)} />
        {m}
      </label>
    {/each}
  </fieldset>
  {#if mode === 'FT8'}
    <div class="group hound">
      <label class="row">
        <span class="row-main"><span class="row-title">Hound</span></span>
        <input type="checkbox" role="switch" class="switch" checked={hound} onchange={(e) => setHound(e.currentTarget.checked)} />
      </label>
      {#if hound}
        <label class="row">
          <span class="row-title">Dial frequency</span>
          <input
            class="field"
            type="text"
            inputmode="decimal"
            bind:value={dialText}
            onblur={saveDial}
            onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            autocomplete="off"
            aria-label="Dial frequency, MHz"
            aria-invalid={dialError !== null}
          />
          <span class="unit">MHz</span>
        </label>
      {/if}
    </div>
    {#if dialError}<p class="err" role="alert">{dialError}</p>{/if}
  {/if}
  {#if mode === 'RTTY'}
    <div class="setblock">
      <label class="k" for="rtty-dial">Set the radio to</label>
      <div class="dialrow">
        <input
          id="rtty-dial"
          class="dialf mono"
          type="text"
          inputmode="decimal"
          bind:this={rttyField}
          bind:value={rttyText}
          onblur={saveRttyDial}
          onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          autocomplete="off"
          aria-invalid={rttyError !== null}
          data-testid="rtty-dial"
        />
        <span class="mhz">MHz</span>
      </div>
      <p class="m">USB</p>
    </div>
    {#if rttyError}<p class="err" role="alert">{rttyError}</p>{/if}
    <p class="note">Update this after each retune: QSOs log it as their frequency.</p>
  {:else}
    <div class="setblock">
      <p class="k">Set the radio to</p>
      <p class="f mono">{dial === null ? '' : mhz(dial)}</p>
      <p class="m">USB</p>
    </div>
    <p class="note">RR73 can’t read the radio’s dial. Saved slots and QSOs record the band chosen here.</p>
  {/if}
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
    border-radius: var(--rr-radius-button);
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

  .tile.off {
    opacity: 0.35;
    cursor: default;
  }

  .tile:has(:focus-visible) {
    outline: 2px solid var(--rr-accent);
    outline-offset: 2px;
  }

  /* The fieldset rule above clears padding; the track keeps its 2 pt inset around the thumb. */
  .seg {
    margin-top: var(--rr-space-3);
    padding: var(--rr-space-half);
  }

  .seg-i.off {
    color: var(--rr-label3);
    cursor: default;
  }

  .hound {
    margin-top: var(--rr-space-3);
    background: var(--rr-sheet-card);
  }

  .field {
    flex: 1;
    min-width: 0;
    height: var(--rr-tap);
    border: 0;
    background: transparent;
    font-size: var(--rr-text-body);
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  .field:focus {
    outline: none;
  }

  .row:has(.field:focus-visible) {
    box-shadow: inset 0 0 0 2px var(--rr-accent);
  }

  .unit {
    flex: none;
    margin-left: var(--rr-space-1);
    color: var(--rr-label2);
  }

  .err {
    margin: var(--rr-space-2) var(--rr-space-4) 0;
    font-size: var(--rr-text-foot);
    line-height: var(--rr-leading-row);
    color: var(--rr-tx-text);
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
    line-height: var(--rr-leading-sideband);
  }

  .dialrow {
    display: flex;
    gap: var(--rr-space-2);
    align-items: center;
    margin-top: var(--rr-space-1);
  }

  /* The dial as a field: the same size as the dial shown for the other modes, in a box that says it can be edited. */
  .dialf {
    width: 7ch;
    min-width: 0;
    height: var(--rr-leading-dial);
    padding: 0 var(--rr-space-1-5);
    border: 2px solid var(--rr-accent);
    border-radius: var(--rr-radius-m);
    background: transparent;
    color: var(--rr-label);
    font-size: var(--rr-text-dial);
    font-weight: var(--rr-weight-bold);
    letter-spacing: -0.02em;
    box-sizing: content-box;
  }

  .dialf:focus {
    outline: none;
  }

  .dialf[aria-invalid='true'] {
    border-color: var(--rr-tx);
  }

  .mhz {
    font-size: var(--rr-text-dial);
    font-weight: var(--rr-weight-bold);
    line-height: var(--rr-leading-dial);
  }

  .note {
    margin: var(--rr-space-3) var(--rr-space-1) 0;
    font-size: var(--rr-text-foot);
    line-height: var(--rr-leading-row);
    color: var(--rr-label2);
  }

  /* A phone on its side: six bands to a row and the dial on one line, so the sheet fits its height. */
  :global([data-size='compact-height']) .bands {
    grid-template-columns: repeat(6, 1fr);
    margin-top: 0;
  }

  :global([data-size='compact-height']) .setblock {
    display: flex;
    gap: var(--rr-space-3);
    align-items: baseline;
    margin-top: var(--rr-space-3);
    padding: var(--rr-space-2) var(--rr-space-4);
  }

  :global([data-size='compact-height']) .f {
    margin-top: 0;
    font-size: var(--rr-hero);
    line-height: var(--rr-leading-title);
  }
</style>
