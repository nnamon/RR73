<script lang="ts">
  /**
   * Text to send: the send queue as a field, 52 pt, growing to 3 lines. The text shows in
   * capitals; on air the next character is underlined and characters leave from the front as
   * they go to the transmitter. Characters the mode cannot send have a red underline. On the
   * right: the queue's length in seconds and a button that empties it. Return sends the line.
   *
   * The styled text is drawn by a copy behind the field, whose own text is transparent, so the
   * caret, selection and the keyboard stay the field's own.
   */
  import { tick } from 'svelte';
  import Icon from './Icon.svelte';

  let {
    value,
    onAir,
    seconds,
    unsendable,
    upper = true,
    ontype,
    onreturn,
    onclear,
  }: {
    value: string;
    onAir: boolean;
    /** The queue's length on the air, s. */
    seconds: number;
    unsendable: ReadonlySet<string>;
    upper?: boolean;
    ontype: (v: string) => void;
    onreturn: () => void;
    onclear: () => void;
  } = $props();

  let ta: HTMLTextAreaElement | undefined = $state();
  let mirror: HTMLDivElement | undefined = $state();
  let shown = '';
  let typing = false;

  // Characters taken from the front keep the caret on its character; text added at the end (Return,
  // a macro) moves a caret that was at the end to the new end.
  $effect.pre(() => {
    const v = value;
    const el = ta;
    if (!el) return;
    if (typing) {
      shown = v;
      return;
    }
    const was = shown;
    shown = v;
    if (document.activeElement !== el || el.value === v) return;
    let cut = 0;
    while (cut < was.length && !v.startsWith(was.slice(cut))) cut++;
    const atEnd = el.selectionStart === was.length && el.selectionEnd === was.length;
    const s = atEnd ? v.length : Math.max(0, el.selectionStart - cut);
    const e = atEnd ? v.length : Math.max(0, el.selectionEnd - cut);
    void tick().then(() => {
      if (document.activeElement === el) el.setSelectionRange(Math.min(s, v.length), Math.min(e, v.length));
    });
  });

  function input(e: Event & { currentTarget: HTMLTextAreaElement }) {
    const el = e.currentTarget;
    const s = el.selectionStart;
    const end = el.selectionEnd;
    const v = el.value;
    typing = true;
    ontype(upper ? v.toUpperCase() : v);
    typing = false;
    void tick().then(() => {
      if (document.activeElement === el) el.setSelectionRange(s, end);
    });
  }

  function key(e: KeyboardEvent) {
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    onreturn();
  }

  function sync() {
    if (ta && mirror) mirror.scrollTop = ta.scrollTop;
  }

  const chars = $derived([...value]);
</script>

<div class="sf" class:blank={!value}>
  <div class="box">
    <div class="mirror" bind:this={mirror} aria-hidden="true">{#each chars as ch, i (i)}{#if ch === '\n'}<br />{:else}<span class:next={onAir && i === 0} class:bad={unsendable.has(ch)}>{ch}</span>{/if}{/each}<span class="end">&#8203;</span></div>
    <textarea
      bind:this={ta}
      {value}
      rows="1"
      placeholder="Text to send"
      aria-label="Text to send"
      autocapitalize="characters"
      autocomplete="off"
      {...{ autocorrect: 'off' }}
      spellcheck="false"
      enterkeyhint="send"
      oninput={input}
      onkeydown={key}
      onscroll={sync}
      data-testid="send-field"
    ></textarea>
  </div>
  {#if value}
    <span class="secs" data-testid="send-seconds">{seconds.toFixed(1)} s</span>
    <button class="x" aria-label="Clear text to send" onclick={onclear}><span class="dot"><Icon name="xmark" size={10} /></span></button>
  {/if}
</div>

<style>
  .sf {
    display: flex;
    gap: var(--rr-space-1);
    align-items: center;
    min-height: 40px;
    margin: var(--rr-space-1-5) calc(var(--rr-space-4) + var(--rr-safe-right)) 0 calc(var(--rr-space-4) + var(--rr-safe-left));
    padding-left: var(--rr-space-3);
    border-radius: var(--rr-radius-l);
    background: var(--rr-fill3);
  }

  .sf:has(textarea:focus-visible) {
    box-shadow: inset 0 0 0 2px var(--rr-accent);
  }

  .box {
    position: relative;
    flex: 1;
    min-width: 0;
    padding: var(--rr-space-2) 0;
  }

  .mirror,
  textarea {
    font-family: var(--rr-mono);
    font-size: var(--rr-text-sub);
    line-height: var(--rr-leading-sub);
    letter-spacing: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  /* The copy sets the height: one line to three. */
  .mirror {
    min-height: var(--rr-leading-sub);
    max-height: calc(3 * var(--rr-leading-sub));
    overflow: hidden;
    color: var(--rr-label);
    text-transform: uppercase;
  }

  .blank .mirror {
    visibility: hidden;
  }

  textarea {
    position: absolute;
    inset: var(--rr-space-2) 0;
    width: 100%;
    height: calc(100% - 2 * var(--rr-space-2));
    padding: 0;
    resize: none;
    overflow-y: auto;
    border: 0;
    background: transparent;
    color: transparent;
    caret-color: var(--rr-accent);
    text-transform: uppercase;
  }

  textarea::placeholder {
    font-family: var(--rr-sans);
    text-transform: none;
    color: var(--rr-label3);
  }

  textarea:focus {
    outline: none;
  }

  .next {
    text-decoration: underline;
    text-decoration-color: var(--rr-tx);
    text-decoration-thickness: 2px;
    text-underline-offset: 3px;
  }

  .bad {
    text-decoration: underline wavy;
    text-decoration-color: var(--rr-tx);
    text-underline-offset: 3px;
  }

  .secs {
    flex: none;
    font-size: var(--rr-text-foot);
    font-variant-numeric: tabular-nums;
    color: var(--rr-label2);
  }

  .x {
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: var(--rr-tap);
    height: var(--rr-tap);
    margin: calc(-1 * var(--rr-space-half)) 0;
  }

  .dot {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--rr-chev);
    color: var(--rr-plain);
  }
</style>
