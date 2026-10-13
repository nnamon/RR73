<script lang="ts">
  /** After a QSO is logged: "Logged JA1KXM 20m FT8 −14 / −09", with Edit and Undo. */
  import { MINUS } from '../lib/clock/format';
  import type { QsoRecord } from '../lib/qso/record';
  import { qso, undoQso } from '../lib/state/qso.svelte';

  let { record, onedit }: { record: QsoRecord; onedit: () => void } = $props();
  const m = (r: string) => r.replace('-', MINUS);
</script>

<div class="toast" role="status">
  <span class="msg">Logged <b class="mono">{record.CALL}</b> {record.BAND} {record.SUBMODE ?? record.MODE} {m(record.RST_SENT)} / {m(record.RST_RCVD)}</span>
  <button class="act" onclick={onedit}>Edit</button>
  <button class="act" onclick={() => undoQso(record.id)}>Undo</button>
  <button class="act close" aria-label="Dismiss the logged notice" onclick={() => (qso.logged = null)}>×</button>
</div>

<style>
  .toast {
    display: flex;
    flex: none;
    gap: var(--rr-space-1);
    align-items: center;
    min-height: var(--rr-tap);
    margin: var(--rr-space-1) var(--rr-space-4);
    padding-left: var(--rr-space-3);
    border-radius: var(--rr-radius-l);
    background: var(--rr-toast);
    color: var(--rr-toast-text);
    font-size: var(--rr-text-row);
  }

  .msg {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .act {
    flex: none;
    min-width: var(--rr-tap);
    min-height: var(--rr-tap);
    padding: 0 var(--rr-space-2);
    color: var(--rr-toast-link);
    font-weight: var(--rr-weight-bold);
  }

  .close {
    color: var(--rr-toast-text);
    font-size: var(--rr-text-body);
  }
</style>
