<script lang="ts">
  /**
   * Call a station, from Operate's •••: a callsign typed in is called on the Tx frequency, in the
   * slot Transmit in sets, for a station heard elsewhere or not decoded yet (qso.svelte.ts
   * callByCallsign).
   */
  import Sheet from './Sheet.svelte';
  import { callByCallsign } from '../lib/state/qso.svelte';
  import { settings } from '../lib/state/settings.svelte';

  let { open = $bindable(false) }: { open: boolean } = $props();

  let call = $state('');
  let refused = $state(false);

  $effect(() => {
    if (open) {
      call = '';
      refused = false;
    }
  });

  function submit(e: SubmitEvent) {
    e.preventDefault();
    if (callByCallsign(call)) open = false;
    else refused = true;
  }
</script>

<Sheet bind:open title="Call a station">
  <form onsubmit={submit}>
    <div class="group">
      <label class="row">
        <span class="row-title">Callsign</span>
        <input
          class="field mono up"
          type="text"
          bind:value={call}
          oninput={() => (refused = false)}
          autocapitalize="characters"
          autocomplete="off"
          spellcheck="false"
          maxlength="13"
          placeholder="Required"
          aria-label="Callsign"
          aria-invalid={refused}
        />
      </label>
    </div>
    <p class="section-foot" class:off={refused} role="status">
      {refused ? 'Not a callsign. Type it as sent, such as K1ABC or VK3/9V1NE.' : `Tx1 goes out on ${settings.txHz} Hz in the ${settings.cqParity === 'even' ? '1st (Even)' : '2nd (Odd)'} slot.`}
    </p>
    <div class="start">
      <button class="btn primary" type="submit" disabled={!call.trim()}>Call</button>
    </div>
  </form>
</Sheet>

<style>
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

  .up {
    text-transform: uppercase;
  }

  .up::placeholder {
    font-family: var(--rr-sans);
    text-transform: none;
  }

  .off {
    color: var(--rr-warn);
  }

  .start {
    display: flex;
    justify-content: center;
    margin-top: var(--rr-space-4);
  }
</style>
