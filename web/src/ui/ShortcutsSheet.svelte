<script lang="ts">
  /** The keyboard shortcuts (lib/app/shortcuts.ts), opened with ?, for the mode chosen. */
  import Sheet from './Sheet.svelte';
  import { isKeyboard } from '../lib/clock/slots';
  import { settings } from '../lib/state/settings.svelte';

  let { open = $bindable(false) }: { open: boolean } = $props();

  type Key = { label: string; keys: string[]; spoken: string };

  const SCREENS: Key[] = [
    { label: 'Operate, Log, Settings', keys: ['⌥', '1', '2', '3'], spoken: 'Option 1, 2, 3' },
    { label: 'Keyboard shortcuts', keys: ['?'], spoken: 'Question mark' },
  ];

  const SLOTS: Key[][] = [
    [
      { label: 'Halt', keys: ['esc'], spoken: 'Escape' },
      { label: 'Call the selected station', keys: ['return'], spoken: 'Return' },
      { label: 'Select the next or previous decode', keys: ['↓', '↑'], spoken: 'Down arrow, up arrow' },
    ],
    [
      { label: 'Tx on or off', keys: ['⌥', 'T'], spoken: 'Option T' },
      { label: 'Call CQ', keys: ['⌥', 'C'], spoken: 'Option C' },
      { label: 'Hunt on or off', keys: ['⌥', 'H'], spoken: 'Option H' },
      { label: 'Change band', keys: ['B'], spoken: 'B' },
    ],
    SCREENS,
  ];

  /** RTTY and the keyboard modes after it: the function keys send the macros, also while typing. */
  const KEYBOARD: Key[][] = [
    [
      { label: 'Halt', keys: ['esc'], spoken: 'Escape' },
      { label: 'Send the line typed', keys: ['return'], spoken: 'Return' },
      { label: 'Send a macro, in its order', keys: ['F1', '…', 'F12'], spoken: 'F1 to F12' },
    ],
    [
      { label: 'Tx on or off', keys: ['⌥', 'T'], spoken: 'Option T' },
      { label: 'Change band', keys: ['B'], spoken: 'B' },
    ],
    SCREENS,
  ];

  const groups = $derived(isKeyboard(settings.mode) ? KEYBOARD : SLOTS);
</script>

<Sheet bind:open title="Keyboard shortcuts">
  {#each groups as group, i (i)}
    <ul class="group keys">
      {#each group as k (k.label)}
        <li class="row">
          <span class="row-main"><span class="row-title">{k.label}</span></span>
          <span class="visually-hidden">{k.spoken}</span>
          <span class="kc" aria-hidden="true">{#each k.keys as key (key)}<kbd>{key}</kbd>{/each}</span>
        </li>
      {/each}
    </ul>
  {/each}
  <p class="section-foot">On Windows and Linux, ⌥ is Alt.</p>
</Sheet>

<style>
  .keys {
    margin-top: var(--rr-space-4);
    background: var(--rr-sheet-card);
  }

  .keys:first-of-type {
    margin-top: var(--rr-space-1);
  }

  .kc {
    display: inline-flex;
    flex: none;
    gap: var(--rr-space-1);
  }

  kbd {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: var(--rr-kbd);
    height: var(--rr-kbd);
    padding: 0 var(--rr-space-1-5);
    border-radius: var(--rr-radius-s);
    background: var(--rr-fill-bg);
    box-shadow: inset 0 calc(-1 * var(--rr-hairline)) 0 var(--rr-sep);
    font-family: var(--rr-sans);
    font-size: var(--rr-text-row);
    font-weight: var(--rr-weight-medium);
  }
</style>
