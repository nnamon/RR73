<script lang="ts">
  /**
   * The QSO strip of a keyboard mode: one 44 pt row above the text to send. QSO set: callsign,
   * RST sent and received, name and QTH. Contest set: callsign, sent ("599 042"), received and
   * Worked when the call is a dupe. Each field is edited in place; empty ones show their name.
   * The chevron opens the full QSO sheet.
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
  }: {
    draft: Draft;
    contest: boolean;
    /** The serial number this QSO sends, as sent ("042"). */
    serial: string;
    worked: boolean;
    onedit: (key: DraftKey, value: string) => void;
    onsheet: () => void;
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

<div class="qs" role="group" aria-label="QSO">
  <label class="f call">
    {#if f.call}<small aria-hidden="true">Call</small>{/if}
    <input
      class="mono"
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
  <label class="f sent">
    <small aria-hidden="true">Sent</small>
    <span class="pair">
      <input class="mono rst" value={f.rstSent} aria-label="RST sent" inputmode="numeric" {...keyOff} maxlength="3" oninput={(e) => onedit('rstSent', e.currentTarget.value)} />
      {#if contest}<span class="mono nr">{serial}</span>{/if}
    </span>
  </label>
  {#if contest}
    <label class="f rcvd wide">
      {#if received}<small aria-hidden="true">Rcvd</small>{/if}
      <input class="mono" value={received} placeholder="Rcvd" aria-label="Received" {...keyOff} maxlength="9" onchange={(e) => editReceived(e.currentTarget.value)} data-testid="strip-rcvd" />
    </label>
    {#if worked}<span class="wk">Worked</span>{/if}
  {:else}
    <label class="f rcvd">
      {#if f.rstRcvd}<small aria-hidden="true">Rcvd</small>{/if}
      <input class="mono rst" value={f.rstRcvd} placeholder="Rcvd" aria-label="RST received" inputmode="numeric" {...keyOff} maxlength="3" oninput={(e) => onedit('rstRcvd', e.currentTarget.value)} data-testid="strip-rcvd" />
    </label>
    <label class="f name">
      {#if f.name}<small aria-hidden="true">Name</small>{/if}
      <input class="mono" value={f.name} placeholder="Name" aria-label="Name" {...keyOff} maxlength="20" oninput={(e) => onedit('name', e.currentTarget.value)} data-testid="strip-name" />
    </label>
    <label class="f qth">
      {#if f.qth}<small aria-hidden="true">QTH</small>{/if}
      <input class="mono" value={f.qth} placeholder="QTH" aria-label="QTH" {...keyOff} maxlength="30" oninput={(e) => onedit('qth', e.currentTarget.value)} data-testid="strip-qth" />
    </label>
    {#if worked}<span class="wk">Worked</span>{/if}
  {/if}
  <button class="cv" aria-label="Open the QSO sheet" onclick={onsheet}><Icon name="chevright" size={14} /></button>
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
  }

  .f {
    position: relative;
    display: flex;
    flex: none;
    flex-direction: column;
    justify-content: center;
    min-width: var(--rr-tap);
    padding: 0 var(--rr-space-2);
    cursor: text;
  }

  .f + .f {
    box-shadow: inset var(--rr-hairline) 0 0 var(--rr-sep);
  }

  .f.call {
    width: 9.2ch;
  }

  .f.rcvd {
    min-width: 5.4ch;
  }

  .f.name {
    width: 7.2ch;
  }

  .f.qth,
  .f.wide {
    flex: 1;
    min-width: 0;
  }

  small {
    font-size: var(--rr-text-tag);
    line-height: var(--rr-leading-tag);
    color: var(--rr-label2);
  }

  input {
    width: 100%;
    min-width: 0;
    height: var(--rr-leading-row);
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--rr-label);
    font-size: var(--rr-text-sub);
    font-weight: var(--rr-weight-semibold);
    text-transform: uppercase;
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

  .pair {
    display: flex;
    gap: var(--rr-space-1);
    align-items: baseline;
  }

  input.rst {
    width: 3.2ch;
  }

  .nr {
    font-size: var(--rr-text-sub);
    font-weight: var(--rr-weight-semibold);
  }

  .wk {
    display: flex;
    flex: none;
    align-items: center;
    align-self: center;
    height: var(--rr-space-5);
    margin-left: auto;
    padding: 0 var(--rr-space-1-5);
    border-radius: var(--rr-radius-pill);
    background: var(--rr-fill);
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

  .cv:focus-visible {
    outline: 2px solid var(--rr-accent);
    outline-offset: -2px;
  }
</style>
