<script lang="ts">
  /**
   * The QSO sheet: add a QSO by hand, or edit or delete one (QsoEditor). Opened from the Log, the
   * logged notice and Fix. Beside the Log's list (compact height and regular width) the QSO opens
   * in the detail pane instead, while the Log shows.
   */
  import QsoEditor from './QsoEditor.svelte';
  import Sheet from './Sheet.svelte';
  import { closeEditor, log, qsoById } from '../lib/log/log.svelte';
  import { qsoPane } from '../lib/log/editor-pane.svelte';

  let open = $state(false);
  let qsoId = $state<string | null>(null);
  /** Each opening mounts a fresh editor, loaded from the QSO. */
  let opening = $state(0);

  $effect(() => {
    if (log.editor.open && !open && !qsoPane.shown) {
      qsoId = log.editor.qsoId;
      opening++;
      open = true;
    }
  });

  const original = $derived(qsoId ? (qsoById(qsoId) ?? null) : null);
  const title = $derived(original ? (original.deletedAt === null ? 'Edit QSO' : 'Deleted QSO') : 'Add QSO');

  function closed() {
    open = false;
    closeEditor();
  }
</script>

<Sheet bind:open {title} onclose={closed} done={false}>
  {#key opening}
    <QsoEditor {qsoId} onclose={closed} />
  {/key}
</Sheet>
