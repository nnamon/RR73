<script lang="ts">
  /**
   * Change band. RR73 cannot read the radio's dial, so the operator chooses the band here and
   * sets the radio to the frequency shown. A tap on a band applies it and closes the sheet; a tap
   * on a mode applies it and keeps the sheet open. Tx keeps its state across a band change.
   * With Hound on, the sheet takes the DXpedition's dial frequency for the band, stored per band.
   * WSPR takes WSPRnet's dial on every band; 2m has WSPR only, so its tile is off in FT8 and FT4.
   * RTTY has no calling frequency: the sheet takes the dial, in MHz or kHz, kept per band, and
   * opens with that field focused, so a retune takes a few digits. FT8 and FT4 take a dial of the
   * operator's own per band and mode in the same field, such as a 60m channel; an empty field, or
   * the usual dial, goes back to the usual one.
   */
  import { tick } from 'svelte';
  import Sheet from './Sheet.svelte';
  import Icon from './Icon.svelte';
  import { BAND_IDS, dialHz, type BandId } from '../lib/radio/bands';
  import { MODES, type Mode } from '../lib/clock/slots';
  import { mhz } from '../lib/clock/format';
  import { settings, updateSettings } from '../lib/state/settings.svelte';
  import { setHound, setHoundDial } from '../lib/state/qso.svelte';
  import { dialText as ftDialText, operatingDialHz, parseDialMhz } from '../lib/radio/hound-dial';
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
  const dial = $derived(operatingDialHz(band, mode, hound, settings.houndDialHz, settings.ftDialHz));

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

  // FT8 and FT4 outside Hound: the operator's own dial, as typed.
  const ownDial = $derived((mode === 'FT8' || mode === 'FT4') && !(hound && mode === 'FT8'));
  const usualHz = $derived(dialHz(band, mode));
  let ftText = $state('');
  let ftError = $state<string | null>(null);
  $effect(() => {
    if (!ownDial) return;
    const hz = operatingDialHz(band, mode, false, {}, settings.ftDialHz);
    ftText = hz === null ? '' : ftDialText(hz);
    ftError = null;
  });

  function saveFtDial() {
    if (mode !== 'FT8' && mode !== 'FT4') return;
    const m = mode;
    const next = { ...settings.ftDialHz[m] };
    if (ftText.trim() === '') delete next[band];
    else {
      const r = parseDialMhz(ftText, band);
      if ('error' in r) {
        ftError = r.error;
        return;
      }
      if (r.hz === usualHz) delete next[band];
      else next[band] = r.hz;
    }
    ftError = null;
    ftText = ftDialText(next[band] ?? usualHz ?? 0);
    if (next[band] !== settings.ftDialHz[m][band]) void updateSettings({ ftDialHz: { ...settings.ftDialHz, [m]: next } });
  }

  /** Back to the band's usual FT8 or FT4 dial. */
  function resetFtDial() {
    if (mode !== 'FT8' && mode !== 'FT4') return;
    const next = { ...settings.ftDialHz[mode] };
    delete next[band];
    ftError = null;
    ftText = usualHz === null ? '' : ftDialText(usualHz);
    void updateSettings({ ftDialHz: { ...settings.ftDialHz, [mode]: next } });
  }

  // RTTY's usual dial on the band, and whether the operator's differs from it.
  const rttyUsualHz = $derived(dialHz(band, 'RTTY'));
  const rttyOwn = $derived(settings.rtty.dialHz[band] !== undefined && settings.rtty.dialHz[band] !== rttyUsualHz);

  /** Back to the band's usual RTTY dial. */
  function resetRttyDial() {
    const next = { ...settings.rtty.dialHz };
    delete next[band];
    rttyError = null;
    rttyText = rttyUsualHz === null ? '' : dial4(rttyUsualHz);
    setRtty({ dialHz: next });
  }

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
        {#if rttyOwn && rttyUsualHz !== null}
          <button class="reset" aria-label="Reset to {dial4(rttyUsualHz)} MHz" onclick={resetRttyDial}><Icon name="reset" class="reset-i" /></button>
        {/if}
      </div>
      <p class="m">USB</p>
    </div>
    {#if rttyError}<p class="err" role="alert">{rttyError}</p>{/if}
    <p class="note">Update this after each retune: QSOs log it as their frequency.</p>
  {:else if ownDial}
    <div class="setblock">
      <label class="k" for="ft-dial">Set the radio to</label>
      <div class="dialrow">
        <input
          id="ft-dial"
          class="dialf mono"
          type="text"
          inputmode="decimal"
          bind:value={ftText}
          onblur={saveFtDial}
          onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          autocomplete="off"
          aria-invalid={ftError !== null}
          data-testid="ft-dial"
        />
        <span class="mhz">MHz</span>
        {#if (mode === 'FT8' || mode === 'FT4') && settings.ftDialHz[mode][band] !== undefined && usualHz !== null}
          <button class="reset" aria-label="Reset to {ftDialText(usualHz)} MHz" onclick={resetFtDial}><Icon name="reset" class="reset-i" /></button>
        {/if}
      </div>
      <p class="m">USB</p>
    </div>
    {#if ftError}<p class="err" role="alert">{ftError}</p>{/if}
    <p class="note">RR73 can’t read the radio’s dial. Saved slots and QSOs record the dial shown here.</p>
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

  /*
   * The dial as a field: the same size as the dial shown for the other modes, in a box that says it
   * can be edited. It narrows no further than its 7 characters and the caret, so a 375 pt screen
   * with the reset button shows every digit.
   */
  .dialf {
    width: 7ch;
    min-width: calc(7ch - 0.1em);
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

  /*
   * Back to the usual dial: the glyph alone in the accent colour, as iOS shows a toolbar glyph, a
   * little under the height of the unit's capitals. Its 44 pt target reaches into the gap and the
   * card's padding. It sits 2 pt below the field's middle, on the middle of the capitals, which
   * SF Pro's line box sets 1 to 2 pt low.
   */
  .reset {
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: var(--rr-tap);
    height: var(--rr-tap);
    margin: 0 calc((var(--rr-dial-reset) - var(--rr-tap)) / 2);
    color: var(--rr-accent);
    translate: 0 var(--rr-space-half);
  }

  .reset :global(.reset-i) {
    width: var(--rr-dial-reset);
    height: var(--rr-dial-reset);
    border-radius: var(--rr-radius-pill);
  }

  /* The ring goes round the glyph: round the 44 pt target it would touch the unit. */
  .reset:focus-visible {
    outline: none;
  }

  .reset:focus-visible :global(.reset-i) {
    outline: 2px solid var(--rr-accent);
    outline-offset: 2px;
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
