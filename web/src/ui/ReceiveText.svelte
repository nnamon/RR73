<script lang="ts">
  /**
   * Received and sent text in a keyboard mode, newest at the bottom as on a teleprinter. 15 pt
   * monospace; lines wrap at the width. Sent text is in the transmit colour, uncertain characters
   * in the third label colour, callsigns semibold with a dotted underline in their decode colours.
   *
   * The pane follows the newest text; scrolled up, it stays where it is and a pill counts the new
   * lines, and a tap on it returns to the newest. A tap on a received word calls `onword` with
   * 'tap'; touch and hold calls it with 'hold'. A swipe down puts the keyboard away.
   */
  import { tick } from 'svelte';
  import Icon from './Icon.svelte';
  import type { Line } from '../lib/keyboard/transcript';
  import { tokens, type CallColour, type Token } from '../lib/keyboard/render';

  let {
    lines,
    resolves,
    colourOf,
    onword,
    keyboardUp = false,
  }: {
    lines: readonly Line[];
    resolves: ((call: string) => boolean) | null;
    colourOf: (call: string) => CallColour;
    /** A received word was tapped or held: the word, its box, and its callsign or null. */
    onword: (word: string, box: DOMRect, how: 'tap' | 'hold', call: string | null) => void;
    keyboardUp?: boolean;
  } = $props();

  let box: HTMLDivElement | undefined = $state();
  let following = $state(true);
  let unseen = $state(0);
  let seenCount = 0;

  // Follow the newest text while at the bottom; count new lines while scrolled up.
  $effect.pre(() => {
    const n = lines.length;
    const el = box;
    if (!el) return;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 8;
    if (atBottom) following = true;
    if (!following && n > seenCount) unseen += n - seenCount;
    seenCount = n;
    void tick().then(() => {
      if (following && box) box.scrollTop = box.scrollHeight;
    });
  });

  $effect(() => {
    void keyboardUp;
    void tick().then(() => {
      if (following && box) box.scrollTop = box.scrollHeight;
    });
  });

  function scrolled() {
    const el = box;
    if (!el) return;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 8;
    following = atBottom;
    if (atBottom) unseen = 0;
  }

  function showNewest() {
    following = true;
    unseen = 0;
    box?.scrollTo({ top: box.scrollHeight, behavior: 'smooth' });
  }

  const HOLD_MS = 500;
  let press: { id: number; x: number; y: number; el: HTMLElement; timer: ReturnType<typeof setTimeout> | null; held: boolean } | null = null;
  let swipe: { y: number } | null = null;

  function wordAt(t: EventTarget | null): HTMLElement | null {
    return t instanceof Element ? (t.closest<HTMLElement>('[data-w]') ?? null) : null;
  }

  function fire(el: HTMLElement, how: 'tap' | 'hold') {
    onword(el.dataset.w ?? '', el.getBoundingClientRect(), how, el.dataset.call || null);
  }

  function down(e: PointerEvent) {
    swipe = { y: e.clientY };
    const el = wordAt(e.target);
    if (!el || e.button !== 0) return;
    const p = { id: e.pointerId, x: e.clientX, y: e.clientY, el, timer: null as ReturnType<typeof setTimeout> | null, held: false };
    p.timer = setTimeout(() => {
      p.held = true;
      fire(el, 'hold');
    }, HOLD_MS);
    press = p;
  }

  function move(e: PointerEvent) {
    if (swipe && keyboardUp && e.clientY - swipe.y > 40) {
      swipe = null;
      (document.activeElement as HTMLElement | null)?.blur();
    }
    const p = press;
    if (!p || p.id !== e.pointerId) return;
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > 8) {
      if (p.timer) clearTimeout(p.timer);
      press = null;
    }
  }

  function up(e: PointerEvent) {
    swipe = null;
    const p = press;
    if (!p || p.id !== e.pointerId) return;
    if (p.timer) clearTimeout(p.timer);
    press = null;
    if (!p.held) fire(p.el, 'tap');
  }

  function cancel() {
    if (press?.timer) clearTimeout(press.timer);
    press = null;
    swipe = null;
  }

  function style(t: Token): string | undefined {
    if (!t.call) return undefined;
    const c = colourOf(t.call);
    return c.bg ? `--rr-hl: ${c.bg}` : undefined;
  }
</script>

<div class="wrap">
  <!-- svelte-ignore a11y_no_static_element_interactions (each word's menu has the strip's fields as its keyboard path) -->
  <div class="rx" bind:this={box} onscroll={scrolled} onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={cancel} oncontextmenu={(e) => e.preventDefault()} role="log" aria-label="Received text" aria-live="off" data-testid="rx-text">
    <div class="col">
      {#each lines as line (line.id)}
        {#if line.kind === 'divider'}
          <div class="dv" role="separator">{line.text}</div>
        {:else}
          <div class="ln">{#each tokens(line, resolves) as t (t.at)}{#if t.space}{t.text}{:else if t.rx}{@const c = t.call ? colourOf(t.call) : null}<span class="w" class:call={!!t.call} class:rr-hl={!!c?.bg} class:hl={!!c?.bg} class:worked={!!c?.worked && !c?.bg} style={style(t)} data-w={t.text} data-call={t.call ?? ''}>{#each t.runs as r, i (i)}<span class="k-{r.kind}">{r.text}</span>{/each}</span>{:else}{#each t.runs as r, i (i)}<span class="k-{r.kind}">{r.text}</span>{/each}{/if}{/each}</div>
        {/if}
      {/each}
    </div>
  </div>
  {#if unseen > 0}
    <button class="newl" onclick={showNewest}><Icon name="chevdown" size={13} />{unseen} new {unseen === 1 ? 'line' : 'lines'}</button>
  {/if}
</div>

<style>
  .wrap {
    position: relative;
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: calc(3 * var(--rr-leading-sub));
    background: var(--rr-plain);
  }

  .rx {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    -webkit-touch-callout: none;
    user-select: none;
  }

  /* The newest line sits at the bottom while the text is shorter than the pane. */
  .col {
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    min-height: 100%;
    padding: var(--rr-space-1) calc(var(--rr-space-4) + var(--rr-safe-right)) var(--rr-space-1-5) calc(var(--rr-space-4) + var(--rr-safe-left));
    font-family: var(--rr-mono);
    font-size: var(--rr-text-sub);
    line-height: var(--rr-leading-sub);
  }

  .ln {
    min-height: var(--rr-leading-sub);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .dv {
    display: flex;
    gap: var(--rr-space-2);
    align-items: center;
    font-family: var(--rr-sans);
    font-size: var(--rr-text-caption);
    line-height: var(--rr-leading-sub);
    color: var(--rr-label2);
  }

  .dv::before,
  .dv::after {
    content: '';
    flex: 1;
    height: var(--rr-hairline);
    background: var(--rr-sep);
  }

  .k-u {
    color: var(--rr-label3);
  }

  .k-t {
    color: var(--rr-tx-text);
  }

  .w {
    cursor: pointer;
  }

  .w.call {
    font-weight: var(--rr-weight-semibold);
    text-decoration: underline dotted;
    text-decoration-thickness: 1.5px;
    text-underline-offset: 3px;
  }

  .w.hl {
    border-radius: var(--rr-radius-xs);
    background: var(--rr-hl-bg);
  }

  .w.worked {
    color: var(--rr-old-text);
  }

  .newl {
    position: absolute;
    right: calc(var(--rr-space-4) + var(--rr-safe-right));
    bottom: var(--rr-space-1-5);
    display: inline-flex;
    gap: var(--rr-space-1);
    align-items: center;
    min-height: var(--rr-tap);
    padding: 0 var(--rr-space-3);
    border-radius: var(--rr-radius-pill);
    background: var(--rr-accent-fill);
    color: var(--rr-on-fill);
    font-size: var(--rr-text-foot);
    font-weight: var(--rr-weight-semibold);
  }
</style>
