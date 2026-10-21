<script lang="ts">
  /**
   * An activation in the log: its references, date and QSO count, where its QSOs went at each
   * direct destination, and each file with Share and Mark submitted.
   */
  import Icon from './Icon.svelte';
  import { refsLabel } from '../lib/log/activation';
  import { buildPartFile, shareFile } from '../lib/log/files';
  import { log, markFileHandled, markFileSubmitted } from '../lib/log/log.svelte';
  import { activationDirect, activationFiles, directText, fileText, shortDate, type FileRow } from '../lib/log/view';
  import type { Activation } from '../lib/log/types';
  import { utcNow } from '../lib/clock/utc';

  let { activation }: { activation: Activation } = $props();

  const count = $derived(log.live.filter((q) => q.activationId === activation.id).length);
  const direct = $derived(activationDirect(activation, log.qsos, log.index, log.facts));
  const files = $derived(activationFiles(activation, log.qsos, log.index, log.facts));
  const running = $derived(activation.endedAt === null);
  let status = $state('');

  /** Builds the file from memory and shares it inside the tap, which the share sheet needs. */
  async function share(f: FileRow) {
    const file = buildPartFile(f.key, log.qsos, activation, { programVersion: __APP_VERSION__, now: utcNow() });
    if (!file) return;
    const r = await shareFile(file);
    status = r.kind === 'downloaded' ? `Downloaded ${file.name}` : r.kind === 'shared' ? `Shared ${file.name}` : '';
  }
</script>

<article class="act" aria-label="{refsLabel(activation.refs)}, {shortDate(activation.startedAt)}">
  <header class="act-h">
    <h3 class="t">{refsLabel(activation.refs)}</h3>
    <p class="s">{shortDate(activation.startedAt)} · {count} {count === 1 ? 'QSO' : 'QSOs'}{running ? ' · running' : ''} · {activation.callsign}</p>
  </header>
  {#each direct as d (d.destination)}
    {@const done = d.total > 0 && d.delivered === d.total}
    <div class="r">
      <span class="ic" class:ok={done} class:warn={!done} aria-hidden="true"><Icon name={done ? 'checkcircle' : 'warncircle'} size={18} /></span>
      <span class="txt">{directText(d)}</span>
    </div>
  {/each}
  {#each files as f (f.key)}
    <div class="r file">
      <span class="ic" class:ok={f.state === 'submitted'} class:warn={f.state !== 'submitted'} aria-hidden="true"><Icon name={f.state === 'submitted' ? 'checkcircle' : 'warncircle'} size={18} /></span>
      <span class="txt">{fileText(f)}</span>
      {#if f.state !== 'submitted'}
        <span class="b">
          <button class="btn compact tint" aria-label="Share the {f.label} file" onclick={() => void share(f)}>Share</button>
          {#if f.state === 'changed'}
            <button class="btn compact" aria-label="Mark the change to the {f.label} file handled" onclick={() => void markFileHandled(f.key)}>Mark handled</button>
          {:else}
            <button class="btn compact" aria-label="Mark the {f.label} file submitted" onclick={() => void markFileSubmitted(f.key)}>Mark submitted</button>
          {/if}
        </span>
      {/if}
    </div>
  {/each}
  {#if !direct.length && !files.length}
    <p class="none">No destination takes this activation’s QSOs. Switch on POTA, SOTA, WWFF or ADIF files in Settings › Logging.</p>
  {/if}
  <p class="visually-hidden" role="status">{status}</p>
</article>

<style>
  .act {
    padding: var(--rr-space-3) var(--rr-space-4) var(--rr-space-1-5);
  }

  .t {
    font-size: var(--rr-text-callout);
    font-weight: var(--rr-weight-bold);
    line-height: var(--rr-leading-sub);
    letter-spacing: -0.02em;
  }

  .s {
    font-size: var(--rr-text-foot);
    line-height: var(--rr-leading-row);
    color: var(--rr-label2);
  }

  .act-h {
    padding-bottom: var(--rr-space-1-5);
    box-shadow: 0 var(--rr-hairline) 0 var(--rr-sep);
  }

  .r {
    display: flex;
    flex-wrap: wrap;
    gap: var(--rr-space-1) var(--rr-space-2);
    align-items: center;
    min-height: 36px;
    padding: var(--rr-space-1) 0;
    font-size: var(--rr-text-sub);
    line-height: var(--rr-leading-sub);
    letter-spacing: -0.015em;
  }

  .ic {
    flex: none;
  }

  .ok {
    color: var(--rr-ok);
  }

  .warn {
    color: var(--rr-warn);
  }

  .txt {
    flex: 1;
    min-width: 0;
  }

  .b {
    display: flex;
    flex-basis: 100%;
    gap: var(--rr-space-2);
    justify-content: flex-end;
  }

  .b .btn {
    font-size: var(--rr-text-foot);
  }

  .none {
    padding: var(--rr-space-2) 0;
    font-size: var(--rr-text-foot);
    color: var(--rr-label2);
  }
</style>
