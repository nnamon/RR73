<script lang="ts">
  /**
   * The QSO strip of a keyboard mode: one 44 pt row above the text to send. QSO set: callsign,
   * RST sent and received, name and QTH. Contest set: callsign, sent ("599 042"), received and
   * Worked when the call is a dupe. Each field is edited in place; empty ones show their name.
   * The chevron opens the full QSO sheet.
   *
   * `panel`, in the transmit panel: the same fields as a form of two rows, each field a rounded
   * cell of its own. The panel's heading carries Worked and the way to the sheet.
   */
  import Icon from './Icon.svelte';
  import type { Draft, DraftKey } from '../lib/keyboard/draft';

  let {
    draft,
    contest,
    serial,
    worked,
    onedit,
    onsheet,
    variant = 'strip',
  }: {
    draft: Draft;
    contest: boolean;
    /** The serial number this QSO sends, as sent ("042"). */
    serial: string;
    worked: boolean;
    onedit: (key: DraftKey, value: string) => void;
    onsheet: () => void;
    variant?: 'strip' | 'panel';
  } = $props();

  const f = $derived(draft.fields);

  /** "599 0877" in the Contest set's received field: the report, then the number. */
  function editReceived(v: string) {
    const parts = v.trim().toUpperCase().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      onedit('rstRcvd', parts[0]);
      onedit('srx', parts[1]);
    } else if (parts.length === 1) {
      if (/^5[1-9][1-9]$/.test(parts[0]) && !f.srx) onedit('rstRcvd', parts[0]);
      else onedit('srx', parts[0]);
    } else {
      onedit('rstRcvd', '');
      onedit('srx', '');
    }
  }

  const received = $derived([f.rstRcvd, f.srx].filter(Boolean).join(' '));
  const keyOff = { autocomplete: 'off', autocapitalize: 'characters', spellcheck: false } as const;
</script>

<div class="qs {variant}" class:contest role="group" aria-label="QSO">
  <label class="f call" class:filled={!!f.call}>
    {#if f.call}<small aria-hidden="true">Call</small>{/if}
    <input
      value={f.call}
      placeholder="Call"
      aria-label="Callsign"
      {...keyOff}
      maxlength="13"
      onchange={(e) => onedit('call', e.currentTarget.value)}
      onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      data-testid="strip-call"
    />
  </label>
  <label class="f sent filled" class:wide-sent={contest}>
    <small aria-hidden="true">Sent</small>
    <input value={f.rstSent} aria-label="RST sent" inputmode="numeric" {...keyOff} maxlength="3" oninput={(e) => onedit('rstSent', e.currentTarget.value)} />
    {#if contest}<span class="nr" aria-label="Serial sent {serial}">{serial}</span>{/if}
  </label>
  {#if contest}
    <label class="f rcvd wide" class:filled={!!received}>
      {#if received}<small aria-hidden="true">Rcvd</small>{/if}
      <input value={received} placeholder="Rcvd" aria-label="Received" {...keyOff} maxlength="9" onchange={(e) => editReceived(e.currentTarget.value)} data-testid="strip-rcvd" />
    </label>
    {#if worked && variant === 'strip'}<span class="wk">Worked</span>{/if}
  {:else}
    <label class="f rcvd" class:filled={!!f.rstRcvd}>
      {#if f.rstRcvd}<small aria-hidden="true">Rcvd</small>{/if}
      <input value={f.rstRcvd} placeholder="Rcvd" aria-label="RST received" inputmode="numeric" {...keyOff} maxlength="3" oninput={(e) => onedit('rstRcvd', e.currentTarget.value)} data-testid="strip-rcvd" />
    </label>
    <label class="f name" class:filled={!!f.name}>
      {#if f.name}<small aria-hidden="true">Name</small>{/if}
      <input value={f.name} placeholder="Name" aria-label="Name" {...keyOff} maxlength="20" oninput={(e) => onedit('name', e.currentTarget.value)} data-testid="strip-name" />
    </label>
    <label class="f qth" class:filled={!!f.qth}>
      {#if f.qth}<small aria-hidden="true">QTH</small>{/if}
      <input value={f.qth} placeholder="QTH" aria-label="QTH" {...keyOff} maxlength="30" oninput={(e) => onedit('qth', e.currentTarget.value)} data-testid="strip-qth" />
    </label>
    {#if worked && variant === 'strip'}<span class="wk">Worked</span>{/if}
  {/if}
  {#if variant === 'strip'}<button class="cv" aria-label="Open the QSO sheet" onclick={onsheet}><Icon name="chevright" size={14} /></button>{/if}
</div>

<style>
  .qs {
    display: flex;
    align-items: stretch;
    height: var(--rr-tap);
    margin: 0 calc(var(--rr-space-4) + var(--rr-safe-right)) 0 calc(var(--rr-space-4) + var(--rr-safe-left));
    overflow: hidden;
    border-radius: var(--rr-radius-l);
    background: var(--rr-fill3);
    font-family: var(--rr-mono);
    font-size: var(--rr-text-sub);
  }

  /* Each field is a 44 pt target: the input fills its cell, the caption sits over its top. */
  .f {
    position: relative;
    flex: none;
    width: calc(3ch + 2 * var(--rr-space-1-5));
    min-width: var(--rr-tap);
    cursor: text;
  }

  .f + .f {
    box-shadow: inset var(--rr-hairline) 0 0 var(--rr-sep);
  }

  .f.rcvd {
    min-width: calc(var(--rr-tap) + var(--rr-space-1));
  }

  .f.call {
    width: calc(7ch + 2 * var(--rr-space-1-5));
  }

  .f.sent.wide-sent {
    width: calc(7ch + 2 * var(--rr-space-1-5));
  }

  .f.name {
    width: calc(6ch + 2 * var(--rr-space-1-5));
  }

  .f.qth,
  .f.wide {
    flex: 1;
    min-width: var(--rr-tap);
  }

  small {
    position: absolute;
    top: var(--rr-space-1);
    left: var(--rr-space-1-5);
    font-family: var(--rr-sans);
    font-size: var(--rr-text-tag);
    line-height: var(--rr-leading-tag);
    color: var(--rr-label2);
    pointer-events: none;
  }

  input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    padding: 0 var(--rr-space-1-5);
    border: 0;
    background: transparent;
    color: var(--rr-label);
    font: inherit;
    font-weight: var(--rr-weight-semibold);
    text-transform: uppercase;

    /* A value wider than its cell ends in an ellipsis while the field is not being edited. */
    text-overflow: ellipsis;
  }

  .filled input {
    padding-top: var(--rr-space-3);
  }

  input::placeholder {
    font-family: var(--rr-sans);
    font-weight: var(--rr-weight-regular);
    text-transform: none;
    color: var(--rr-label3);
  }

  input:focus {
    outline: none;
  }

  .f:has(input:focus-visible) {
    box-shadow: inset 0 0 0 2px var(--rr-accent);
  }

  .f.call input {
    font-size: var(--rr-text-decode);
  }

  .nr {
    position: absolute;
    right: var(--rr-space-1-5);
    bottom: calc(var(--rr-space-1-5) + var(--rr-space-half));
    font-weight: var(--rr-weight-semibold);
    pointer-events: none;
  }

  .wide-sent input {
    padding-right: calc(4ch + var(--rr-space-1-5));
  }

  .wk {
    display: flex;
    flex: none;
    align-items: center;
    align-self: center;
    height: var(--rr-space-5);
    margin: 0 var(--rr-space-1);
    padding: 0 var(--rr-space-1-5);
    border-radius: var(--rr-radius-pill);
    background: var(--rr-fill);
    font-family: var(--rr-sans);
    font-size: var(--rr-text-caption);
    font-weight: var(--rr-weight-semibold);
  }

  .cv {
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: var(--rr-tap);
    margin-left: auto;
    color: var(--rr-chev);
  }

  /*
   * The transmit panel: call, sent and received on the first row, name and QTH on the second; in
   * the Contest set, the call, then sent and received. Each cell is 52 pt high.
   */
  .panel {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) var(--rr-cell-rst) var(--rr-cell-rst);
    gap: var(--rr-space-2);
    height: auto;
    margin: 0;
    overflow: visible;
    border-radius: 0;
    background: none;
  }

  .panel .f {
    width: auto;
    height: var(--rr-cell);
    border-radius: var(--rr-radius-m);
    background: var(--rr-fill3);
  }

  .panel .f + .f {
    box-shadow: none;
  }

  .panel .f.call,
  .panel .f.name {
    grid-column: span 2;
  }

  .panel .f.qth {
    grid-column: span 2;
  }

  .panel.contest .f.call {
    grid-column: 1 / -1;
  }

  .panel.contest .f.sent,
  .panel.contest .f.rcvd {
    grid-column: span 2;
  }

  .panel .filled input {
    padding-top: var(--rr-space-4);
  }

  .panel .f:has(input:focus-visible) {
    box-shadow: inset 0 0 0 2px var(--rr-accent);
  }

  .cv:focus-visible {
    outline: 2px solid var(--rr-accent);
    outline-offset: -2px;
  }
</style>
