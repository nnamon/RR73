<script lang="ts">
  /** Tx1 to Tx6: choose the next message and edit any of them. Each edit is checked by the encoder. */
  import Sheet from './Sheet.svelte';
  import { TX_NUMS, type TxNum } from '../lib/qso/messages';
  import { messages } from '../lib/qso/sequencer';
  import { codec } from '../lib/state/station.svelte';
  import { chooseNext, editMessage, qso } from '../lib/state/qso.svelte';

  let { open = $bindable(false) }: { open: boolean } = $props();

  const LABEL: Record<TxNum, string> = { 1: 'Grid', 2: 'Report', 3: 'R-report', 4: 'RR73', 5: '73', 6: 'CQ' };
  const all = $derived(messages(qso.st));
  let drafts = $state<Record<number, string>>({});
  let errors = $state<Record<number, string>>({});

  $effect(() => {
    if (open) {
      drafts = { ...all };
      errors = {};
    }
  });

  async function save(tx: TxNum) {
    const text = (drafts[tx] ?? '').trim();
    if (text === all[tx]) return;
    if (!text) {
      editMessage(tx, '');
      errors = { ...errors, [tx]: '' };
      return;
    }
    try {
      const p = await codec().pack(text, qso.st.config.mode);
      if (p.ok) {
        editMessage(tx, p.text);
        drafts = { ...drafts, [tx]: p.text };
        errors = { ...errors, [tx]: '' };
      } else errors = { ...errors, [tx]: `Cannot be sent: ${p.error}.` };
    } catch {
      errors = { ...errors, [tx]: 'The encoder is not available. Start audio to load it.' };
    }
  }
</script>

<Sheet bind:open title="Messages">
  <fieldset class="list">
    <legend class="visually-hidden">Next message</legend>
    {#each TX_NUMS as tx (tx)}
      <div class="msg" class:cur={qso.st.current === tx}>
        <label class="pick">
          <input type="radio" name="next-tx" value={tx} checked={qso.st.current === tx} disabled={!all[tx]} onchange={() => chooseNext(tx)} />
          <span>Tx {tx}<small>{LABEL[tx]}</small></span>
        </label>
        <input
          class="text mono"
          aria-label="Tx {tx} text"
          value={drafts[tx] ?? ''}
          oninput={(e) => (drafts = { ...drafts, [tx]: (e.currentTarget as HTMLInputElement).value.toUpperCase() })}
          onblur={() => void save(tx)}
          onkeydown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
          autocapitalize="characters"
          autocomplete="off"
          spellcheck="false"
          maxlength="37"
          placeholder={tx <= 5 ? 'Needs a station' : ''}
        />
      </div>
      {#if errors[tx]}<p class="err" role="alert">{errors[tx]}</p>{/if}
    {/each}
  </fieldset>
  <p class="note">Choosing a message sends it next. Edits to Tx1 to Tx5 last until you call another station. Tx6 keeps its text.</p>
</Sheet>

<style>
  fieldset {
    margin: var(--rr-space-3) 0 0;
    padding: 0;
    border: 0;
  }

  .msg {
    display: flex;
    gap: var(--rr-space-2);
    align-items: center;
    min-height: var(--rr-tap);
    margin-top: var(--rr-space-1-5);
    padding: 0 var(--rr-space-2);
    border-radius: var(--rr-radius-l);
    background: var(--rr-sheet-card);
  }

  .msg.cur {
    box-shadow: inset 0 0 0 2px var(--rr-accent-fill);
  }

  .pick {
    display: flex;
    flex: none;
    gap: var(--rr-space-2);
    align-items: center;
    width: 96px;
    min-height: var(--rr-tap);
    font-size: var(--rr-text-sub);
    font-weight: var(--rr-weight-semibold);
    cursor: pointer;
  }

  .pick input {
    width: 20px;
    height: 20px;
    margin: 0;
    accent-color: var(--rr-accent-fill);
  }

  .pick small {
    display: block;
    font-size: var(--rr-text-caption);
    font-weight: var(--rr-weight-regular);
    color: var(--rr-label2);
  }

  .text {
    flex: 1;
    min-width: 0;
    height: var(--rr-tap);
    border: 0;
    background: transparent;
    font-size: var(--rr-text-body);
  }

  .text:focus {
    outline: none;
  }

  .msg:has(.text:focus-visible) {
    box-shadow: inset 0 0 0 2px var(--rr-accent);
  }

  .err {
    margin: var(--rr-space-1) var(--rr-space-2) 0;
    font-size: var(--rr-text-foot);
    color: var(--rr-tx-text);
  }

  .note {
    margin: var(--rr-space-3) var(--rr-space-1) 0;
    font-size: var(--rr-text-foot);
    line-height: var(--rr-leading-row);
    color: var(--rr-label2);
  }
</style>
