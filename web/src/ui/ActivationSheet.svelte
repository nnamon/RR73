<script lang="ts">
  /** Start an activation, or edit the running one, from Spots. */
  import ActivationForm from './ActivationForm.svelte';
  import Sheet from './Sheet.svelte';
  import { log, startActivation, updateActivation, type ActivationInput } from '../lib/log/log.svelte';

  let { open = $bindable(false), edit = false }: { open: boolean; edit?: boolean } = $props();

  async function submit(input: ActivationInput) {
    const running = log.current;
    if (edit && running) await updateActivation(running.id, input);
    else await startActivation(input);
    open = false;
  }
</script>

<Sheet bind:open title={edit ? 'Edit activation' : 'Start activation'}>
  {#if open}
    {#if edit}<p class="note">QSOs already logged take the new references, callsign and grid.</p>{/if}
    <ActivationForm initial={edit ? log.current : null} submitLabel={edit ? 'Save activation' : 'Start activation'} onsubmit={submit} oncancel={() => (open = false)} />
  {/if}
</Sheet>

<style>
  .note {
    margin: var(--rr-space-3) var(--rr-space-1) 0;
    font-size: var(--rr-text-foot);
    line-height: var(--rr-leading-row);
    color: var(--rr-label2);
    text-align: center;
  }
</style>
