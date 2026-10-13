<script lang="ts">
  /**
   * The colour for one decode colour category: a palette, and the system colour picker for any
   * other colour. A palette tap applies the colour and closes the sheet; the picker applies each
   * colour as it changes.
   */
  import Icon from './Icon.svelte';
  import Sheet from './Sheet.svelte';
  import { PALETTE, category, normaliseColour, type HighlightEntry } from '../lib/decode/highlight';
  import { inkFor } from '../lib/decode/highlight-colour';

  let { open = $bindable(false), entry, onpick }: { open: boolean; entry: HighlightEntry | null; onpick: (colour: string) => void } = $props();

  const cat = $derived(entry ? category(entry.id) : null);
  const style = $derived(cat?.style ?? 'background');

  function pick(colour: string) {
    onpick(colour);
    open = false;
  }
</script>

<Sheet bind:open title={cat?.label ?? 'Colour'}>
  {#if entry && cat}
    <div class="palette" role="group" aria-label="Colours">
      {#each PALETTE as p (p.colour)}
        {@const ink = style === 'text' ? inkFor(p.colour, null) : null}
        <button
          type="button"
          class="sw {style === 'text' ? 'rr-ink hl-ink' : 'rr-hl hl-background'}"
          style:--rr-hl={p.colour}
          style:--rr-ink-light={ink?.light}
          style:--rr-ink-dark={ink?.dark}
          aria-label={p.name}
          aria-pressed={entry.colour === p.colour}
          onclick={() => pick(p.colour)}
        >
          <span class="chip" aria-hidden="true">{#if style === 'text'}Aa{/if}</span>
          {#if entry.colour === p.colour}<span class="tick"><Icon name="check" size={14} /></span>{/if}
        </button>
      {/each}
    </div>
    <div class="group card">
      <label class="row">
        <span class="row-main"><span class="row-title">Custom colour</span></span>
        <span class="custom">
          <input
            class="picker"
            type="color"
            value={entry.colour.toLowerCase()}
            oninput={(e) => {
              const c = normaliseColour(e.currentTarget.value);
              if (c) onpick(c);
            }}
          />
        </span>
      </label>
    </div>
  {/if}
</Sheet>

<style>
  .palette {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(var(--rr-tap), 1fr));
    gap: var(--rr-space-1);
    margin-top: var(--rr-space-4);
  }

  .sw {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: var(--rr-tap);
    height: var(--rr-tap);
    border-radius: var(--rr-radius-l);
  }

  .chip {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    width: 36px;
    height: 36px;
    border-radius: var(--rr-radius-m);
    box-shadow: inset 0 0 0 var(--rr-hairline) var(--rr-sep-strong);
    font-size: var(--rr-text-sub);
    font-weight: var(--rr-weight-semibold);
  }

  .hl-background .chip {
    background: var(--rr-hl-bg);
  }

  .hl-background .chip::before {
    content: '';
    position: absolute;
    inset: 0 auto 0 0;
    width: var(--rr-mark-bar);
    background: var(--rr-hl);
  }

  .hl-ink .chip {
    background: var(--rr-plain);
    color: var(--rr-hl-ink);
  }

  .sw[aria-pressed='true'] .chip {
    box-shadow: 0 0 0 2px var(--rr-sheet), 0 0 0 4px var(--rr-accent-fill);
  }

  .sw:focus-visible {
    outline: 2px solid var(--rr-accent);
    outline-offset: -2px;
  }

  .tick {
    position: absolute;
    right: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border-radius: var(--rr-radius-pill);
    background: var(--rr-accent-fill);
    color: var(--rr-on-fill);
  }

  .card {
    margin-top: var(--rr-space-4);
    background: var(--rr-sheet-card);
  }

  .custom {
    display: flex;
    flex: none;
  }

  .picker {
    width: var(--rr-tap);
    height: var(--rr-tap);
    padding: 0;
    border: 0;
    border-radius: var(--rr-radius-m);
    background: transparent;
    cursor: pointer;
  }

</style>
