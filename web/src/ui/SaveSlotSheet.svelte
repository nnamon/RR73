<script lang="ts">
  /** Save one of the recent slots as corpus files: share sheet where possible, else download links. */
  import Sheet from './Sheet.svelte';
  import { slotStem, utcTime } from '../lib/clock/format';
  import { SLOT_SAMPLES, parity } from '../lib/clock/slots';
  import type { DownloadLinks } from '../lib/slots/share';
  import { recent, saveRecentSlot, type SlotSummary } from '../lib/state/station.svelte';

  let { open = $bindable(false) }: { open: boolean } = $props();

  let links = $state<DownloadLinks | null>(null);
  let status = $state('');

  function describe(s: SlotSummary): string {
    const p = parity(s.startUtcMs, s.mode) === 'even' ? 'Even' : 'Odd';
    const share = Math.round((s.filled / SLOT_SAMPLES[s.mode]) * 100);
    const state = s.gap ? `audio gap, ${share} % recorded` : s.lateStart ? `started late, ${share} % recorded` : 'complete';
    return `${s.mode} · ${p} · ${state}`;
  }

  function save(s: SlotSummary) {
    links?.revoke();
    links = null;
    status = '';
    const pending = saveRecentSlot(s.startUtcMs);
    if (!pending) {
      status = 'That slot is no longer kept. Choose a newer one.';
      return;
    }
    void pending.then((r) => {
      if (r.kind === 'shared') status = `Shared ${slotStem(s.startUtcMs)}.`;
      else if (r.kind === 'links') {
        links = r.links;
        status = 'This browser cannot share files. Download both files below.';
      }
    });
  }

  function closed() {
    links?.revoke();
    links = null;
    status = '';
  }
</script>

<Sheet bind:open title="Save a slot" onclose={closed}>
  {#if recent.slots.length === 0}
    <p class="note">No slots yet. Slots appear here as each one ends while audio runs.</p>
  {:else}
    <ul class="group slots" aria-label="Recent slots">
      {#each recent.slots as s (s.startUtcMs)}
        <li>
          <button class="row" onclick={() => save(s)} aria-label="Save the slot at {utcTime(s.startUtcMs)} UTC, {describe(s)}">
            <span class="row-main">
              <span class="row-title mono">{utcTime(s.startUtcMs)} UTC</span>
              <span class="row-sub">{describe(s)}</span>
            </span>
            <span class="row-value act">Save</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
  <p class="note" role="status">{status}</p>
  {#if links}
    <div class="links">
      <a class="btn tint" href={links.wav.url} download={links.wav.name}>Download {links.wav.name}</a>
      <a class="btn tint" href={links.json.url} download={links.json.name}>Download {links.json.name}</a>
    </div>
  {/if}
  <p class="note">RR73 keeps the last 8 slots, about 2 minutes. Each slot saves as a 16-bit 12 kHz mono WAV with a JSON sidecar for the decoder corpus.</p>
</Sheet>

<style>
  .slots {
    margin-top: var(--rr-space-3);
    background: var(--rr-sheet-card);
  }

  .slots li + li .row::before {
    content: '';
    position: absolute;
    top: 0;
    right: 0;
    left: var(--rr-space-4);
    height: var(--rr-hairline);
    background: var(--rr-sep-strong);
    transform: scaleY(0.5);
    transform-origin: 0 0;
  }

  .act {
    color: var(--rr-accent);
    font-weight: var(--rr-weight-semibold);
  }

  .links {
    display: flex;
    flex-direction: column;
    gap: var(--rr-space-2);
    margin-top: var(--rr-space-2);
  }

  .links .btn {
    white-space: normal;
    text-align: center;
  }

  .note {
    margin: var(--rr-space-3) var(--rr-space-1) 0;
    font-size: var(--rr-text-foot);
    line-height: var(--rr-leading-row);
    color: var(--rr-label2);
  }

  .note:empty {
    display: none;
  }
</style>
