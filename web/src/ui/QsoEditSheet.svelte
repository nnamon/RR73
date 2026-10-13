<script lang="ts">
  /** Edits a logged QSO from this session. */
  import Sheet from './Sheet.svelte';
  import { editQso } from '../lib/state/qso.svelte';
  import type { QsoRecord } from '../lib/qso/record';

  let { open = $bindable(false), record }: { open: boolean; record: QsoRecord | null } = $props();

  let call = $state('');
  let grid = $state('');
  let sent = $state('');
  let rcvd = $state('');
  let comment = $state('');
  let error = $state('');

  $effect(() => {
    if (open && record) {
      call = record.CALL;
      grid = record.GRIDSQUARE ?? '';
      sent = record.RST_SENT;
      rcvd = record.RST_RCVD;
      comment = record.COMMENT ?? '';
      error = '';
    }
  });

  function save() {
    if (!record) return;
    const rpt = /^[+-]\d{2}$/;
    if (!/^[A-Z0-9/]{3,13}$/.test(call.trim().toUpperCase())) return void (error = 'The callsign has characters a callsign cannot have.');
    if (grid && !/^[A-R]{2}\d{2}([A-X]{2})?$/i.test(grid.trim())) return void (error = 'The grid is not a grid square, such as PM95.');
    if (!rpt.test(sent.trim()) || !rpt.test(rcvd.trim())) return void (error = 'Reports are written as sent on air, such as -14 or +03.');
    editQso(record.id, { CALL: call.trim().toUpperCase(), GRIDSQUARE: grid.trim().toUpperCase(), RST_SENT: sent.trim(), RST_RCVD: rcvd.trim(), COMMENT: comment.trim() });
    open = false;
  }
</script>

<Sheet bind:open title="Edit QSO">
  <div class="group form">
    <label class="row"><span class="row-title">Callsign</span><input class="field mono" bind:value={call} autocapitalize="characters" spellcheck="false" /></label>
    <label class="row"><span class="row-title">Grid</span><input class="field mono" bind:value={grid} autocapitalize="characters" spellcheck="false" placeholder="Not received" /></label>
    <label class="row"><span class="row-title">Sent</span><input class="field mono" bind:value={sent} inputmode="numeric" /></label>
    <label class="row"><span class="row-title">Received</span><input class="field mono" bind:value={rcvd} inputmode="numeric" /></label>
    <label class="row"><span class="row-title">Comment</span><input class="field" bind:value={comment} /></label>
  </div>
  {#if error}<p class="err" role="alert">{error}</p>{/if}
  <button class="btn primary save" onclick={save}>Save QSO</button>
</Sheet>

<style>
  .form {
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
    text-align: right;
  }

  .field:focus {
    outline: none;
  }

  .row:has(.field:focus-visible) {
    box-shadow: inset 0 0 0 2px var(--rr-accent);
  }

  .err {
    margin-top: var(--rr-space-2);
    font-size: var(--rr-text-foot);
    color: var(--rr-tx-text);
  }

  .save {
    width: 100%;
    margin-top: var(--rr-space-3);
  }
</style>
