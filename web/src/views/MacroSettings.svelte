<script lang="ts">
  /**
   * Settings › Macros, shared by every keyboard mode (docs/design/rtty.md): the QSO set and the
   * Contest set. Each row shows the label and the first line of text; a tap opens the macro.
   * Rows reorder by dragging the handle (touch and hold, then drag), or with Move up and Move
   * down; a swipe to the left deletes, with Undo. Add macro goes at the end of the set. Restore
   * defaults asks once and names what is replaced.
   *
   * A macro: Label, Text, field buttons that insert {CALL} and the rest at the cursor, Return to
   * Rx, Log QSO when sent, and Sends now: the text with the fields of the QSO in progress.
   */
  import BackLink from '../ui/BackLink.svelte';
  import Icon from '../ui/Icon.svelte';
  import Sheet from '../ui/Sheet.svelte';
  import { go, href } from '../lib/app/router.svelte';
  import { FIELDS, changedCount, defaultMacros, newMacroId, type Macro, type MacroSetId } from '../lib/keyboard/macros';
  import { notify } from '../lib/log/log.svelte';
  import { settings, updateSettings } from '../lib/state/settings.svelte';
  import { session } from '../lib/state/keyboard.svelte';

  let { macroId = null }: { macroId?: string | null } = $props();

  let view = $state<MacroSetId>(settings.keyboard.set);
  const sets = $derived(settings.keyboard.macros);
  const list = $derived(sets[view]);
  const editing = $derived.by(() => {
    if (!macroId) return null;
    for (const k of ['qso', 'contest'] as const) {
      const m = sets[k].find((x) => x.id === macroId);
      if (m) return { set: k, macro: m };
    }
    return null;
  });

  function saveSet(set: MacroSetId, next: Macro[]) {
    void updateSettings({ keyboard: { ...settings.keyboard, macros: { ...settings.keyboard.macros, [set]: next } } });
  }

  function saveMacro(set: MacroSetId, m: Macro) {
    saveSet(
      set,
      settings.keyboard.macros[set].map((x) => (x.id === m.id ? m : x)),
    );
  }

  function remove(set: MacroSetId, id: string) {
    const before = settings.keyboard.macros[set];
    const m = before.find((x) => x.id === id);
    if (!m) return;
    saveSet(
      set,
      before.filter((x) => x.id !== id),
    );
    notify({ kind: 'cleared', qsoId: null, text: `Deleted ${m.label}`, undo: () => saveSet(set, before) });
  }

  function add() {
    const m: Macro = { id: newMacroId(), label: 'New', text: '', returnToRx: true, logWhenSent: false };
    saveSet(view, [...list, m]);
    go('settings', 'macros', m.id);
  }

  function move(from: number, to: number) {
    if (to < 0 || to >= list.length || from === to) return;
    const next = [...list];
    const [m] = next.splice(from, 1);
    next.splice(to, 0, m);
    saveSet(view, next);
  }

  // Restore defaults, with one confirmation that names what is replaced.
  let restoring = $state(false);
  const defaults = $derived(defaultMacros()[view]);
  const edited = $derived(changedCount(list, defaults));
  function restore() {
    saveSet(view, defaultMacros()[view]);
    restoring = false;
  }

  // Dragging a row by its handle: touch and hold lifts it (a mouse lifts it on the first move).
  const LONG_PRESS_MS = 350;
  let listEl: HTMLUListElement | undefined = $state();
  let drag = $state<{ id: string; from: number; to: number; dy: number; h: number } | null>(null);

  function shift(i: number): string | undefined {
    const d = drag;
    if (!d) return undefined;
    if (i === d.from) return `translateY(${d.dy}px)`;
    if (d.from < d.to && i > d.from && i <= d.to) return `translateY(${-d.h}px)`;
    if (d.from > d.to && i < d.from && i >= d.to) return `translateY(${d.h}px)`;
    return undefined;
  }

  function handle(node: HTMLElement, index: () => number) {
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || drag || !listEl) return;
      const from = index();
      const y0 = e.clientY;
      const row = node.closest('li');
      const h = row?.getBoundingClientRect().height ?? 52;
      let lifted = false;
      const lift = () => {
        lifted = true;
        drag = { id: list[from].id, from, to: from, dy: 0, h };
      };
      const timer = e.pointerType === 'mouse' ? null : setTimeout(lift, LONG_PRESS_MS);
      const mv = (ev: PointerEvent) => {
        if (!lifted) {
          if (e.pointerType === 'mouse' && Math.abs(ev.clientY - y0) > 3) lift();
          else if (Math.abs(ev.clientY - y0) > 8 && timer) {
            clearTimeout(timer);
            end(false);
          }
          return;
        }
        ev.preventDefault();
        const dy = ev.clientY - y0;
        const to = Math.max(0, Math.min(list.length - 1, from + Math.round(dy / h)));
        drag = { id: list[from].id, from, to, dy, h };
      };
      const end = (commit: boolean) => {
        if (timer) clearTimeout(timer);
        window.removeEventListener('pointermove', mv);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', cancel);
        const d = drag;
        drag = null;
        if (commit && d && d.to !== d.from) move(d.from, d.to);
      };
      const up = () => end(true);
      const cancel = () => end(false);
      window.addEventListener('pointermove', mv, { passive: false });
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', cancel);
    };
    node.addEventListener('pointerdown', down);
    return {
      destroy() {
        node.removeEventListener('pointerdown', down);
      },
    };
  }

  // Swipe a row to the left to delete it.
  let swipe = $state<{ id: string; dx: number } | null>(null);
  function swipeable(node: HTMLElement, id: () => string) {
    let start: { x: number; y: number; pid: number } | null = null;
    let horizontal = false;
    const down = (e: PointerEvent) => {
      if ((e.target as Element).closest('.grip, .moves')) return;
      start = { x: e.clientX, y: e.clientY, pid: e.pointerId };
      horizontal = false;
    };
    const mv = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.pid) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (!horizontal && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.5) horizontal = true;
      if (horizontal) swipe = { id: id(), dx: Math.min(0, dx) };
    };
    const up = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.pid) return;
      const s = swipe;
      start = null;
      swipe = null;
      if (horizontal && s && s.dx < -node.getBoundingClientRect().width * 0.4) remove(view, s.id);
    };
    const click = (e: MouseEvent) => {
      if (horizontal) {
        e.preventDefault();
        e.stopPropagation();
        horizontal = false;
      }
    };
    node.addEventListener('pointerdown', down);
    node.addEventListener('pointermove', mv);
    node.addEventListener('pointerup', up);
    node.addEventListener('pointercancel', () => ((start = null), (swipe = null)));
    node.addEventListener('click', click, true);
    return {
      destroy() {
        node.removeEventListener('pointerdown', down);
        node.removeEventListener('pointermove', mv);
        node.removeEventListener('pointerup', up);
        node.removeEventListener('click', click, true);
      },
    };
  }

  // ---- One macro ----
  let label = $state('');
  let text = $state('');
  let textEl: HTMLTextAreaElement | undefined = $state();
  let editingId = '';
  $effect(() => {
    const e = editing;
    if (!e) return;
    if (e.macro.id !== editingId) {
      editingId = e.macro.id;
      label = e.macro.label;
      text = e.macro.text;
    }
  });

  function saveLabel() {
    const e = editing;
    if (!e) return;
    const l = label.trim() || e.macro.label;
    label = l;
    if (l !== e.macro.label) saveMacro(e.set, { ...e.macro, label: l });
  }

  function saveText() {
    const e = editing;
    if (!e) return;
    const t = text.toUpperCase();
    if (t !== e.macro.text) saveMacro(e.set, { ...e.macro, text: t });
  }

  function insert(field: string) {
    const el = textEl;
    const token = `{${field}}`;
    const s = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const before = text.slice(0, s);
    const pad = before && !before.endsWith(' ') ? ' ' : '';
    text = `${before}${pad}${token}${text.slice(end)}`;
    saveText();
    const at = s + pad.length + token.length;
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at, at);
    });
  }

  const sends = $derived(session.preview(text));
  const firstLine = (t: string) => t.split('\n')[0];
</script>

{#if macroId && editing}
  {@const e = editing}
  <section class="screen sub" aria-labelledby="macro-title">
    <BackLink to={href('settings', 'macros')} label="Macros" title={e.macro.label} id="macro-title" />
    <div class="section">
      <h2 class="section-head" id="macro-label">Label</h2>
      <div class="group">
        <input class="tf" type="text" bind:value={label} onblur={saveLabel} onkeydown={(ev) => ev.key === 'Enter' && ev.currentTarget.blur()} maxlength="24" autocomplete="off" aria-labelledby="macro-label" placeholder="Required" />
      </div>
    </div>
    <div class="section">
      <h2 class="section-head" id="macro-text">Text</h2>
      <div class="group text-group">
        <textarea class="ta mono" bind:this={textEl} bind:value={text} oninput={saveText} rows="4" autocapitalize="characters" autocomplete="off" spellcheck="false" aria-labelledby="macro-text"></textarea>
        <div class="fields" role="group" aria-label="Insert a field">
          {#each FIELDS as f (f)}
            <button type="button" class="fb mono" onpointerdown={(ev) => ev.preventDefault()} onclick={() => insert(f)}><span>{`{${f}}`}</span></button>
          {/each}
        </div>
      </div>
    </div>
    <div class="section">
      <div class="group">
        <label class="row">
          <span class="row-main"><span class="row-title">Return to Rx</span></span>
          <input type="checkbox" role="switch" class="switch" checked={e.macro.returnToRx} onchange={(ev) => saveMacro(e.set, { ...e.macro, returnToRx: ev.currentTarget.checked })} />
        </label>
        <label class="row">
          <span class="row-main"><span class="row-title">Log QSO when sent</span></span>
          <input type="checkbox" role="switch" class="switch" checked={e.macro.logWhenSent} onchange={(ev) => saveMacro(e.set, { ...e.macro, logWhenSent: ev.currentTarget.checked })} />
        </label>
      </div>
    </div>
    <div class="section">
      <h2 class="section-head">Sends now</h2>
      <div class="group"><p class="sends mono" data-testid="macro-sends">{sends}</p></div>
    </div>
    <div class="section">
      <div class="group">
        <button
          class="row danger"
          onclick={() => {
            remove(e.set, e.macro.id);
            go('settings', 'macros');
          }}>Delete macro</button
        >
      </div>
    </div>
  </section>
{:else}
  <section class="screen sub" aria-labelledby="macros-title">
    <BackLink to={href('settings', 'rtty')} label="RTTY" title="Macros" id="macros-title" />
    <div class="section">
      <div class="seg" role="radiogroup" aria-label="Macro set">
        {#each [{ id: 'qso', label: 'QSO' }, { id: 'contest', label: 'Contest' }] as o (o.id)}
          <label class="seg-i" class:on={view === o.id}>
            <input class="visually-hidden" type="radio" name="macro-set" value={o.id} checked={view === o.id} onchange={() => (view = o.id as MacroSetId)} />
            {o.label}
          </label>
        {/each}
      </div>
    </div>
    <div class="section">
      <ul class="group mlist" class:dragging={drag !== null} bind:this={listEl} aria-label="{view === 'qso' ? 'QSO' : 'Contest'} macros">
        {#each list as m, i (m.id)}
          <li class="mrow" class:lifted={drag?.id === m.id} style:transform={swipe?.id === m.id ? `translateX(${swipe.dx}px)` : shift(i)} use:swipeable={() => m.id}>
            <span class="grip" use:handle={() => i} aria-hidden="true"><Icon name="grip" size={18} /></span>
            <a class="ml" href={href('settings', 'macros', m.id)}>
              <span class="mt">{m.label}</span>
              <span class="mx mono">{firstLine(m.text) || ' '}</span>
            </a>
            <span class="moves">
              <button type="button" class="move" aria-label="Move {m.label} up" disabled={i === 0} onclick={() => move(i, i - 1)}><Icon name="chevup" size={16} /></button>
              <button type="button" class="move" aria-label="Move {m.label} down" disabled={i === list.length - 1} onclick={() => move(i, i + 1)}><Icon name="chevdown" size={16} /></button>
            </span>
            <Icon name="chevright" size={13} class="row-chevron" />
          </li>
        {/each}
      </ul>
    </div>
    <div class="section">
      <div class="group"><button class="row act" onclick={add}>Add macro</button></div>
    </div>
    <div class="section">
      <div class="group"><button class="row act" onclick={() => (restoring = true)}>Restore defaults</button></div>
    </div>
  </section>
{/if}

<Sheet bind:open={restoring} title="Restore {defaults.length} default macros?">
  <p class="confirm-text">{edited === 0 ? 'The set matches the defaults.' : `Your ${edited} edited ${edited === 1 ? 'macro is' : 'macros are'} replaced.`}</p>
  <button class="btn tx wide" onclick={restore}>Restore defaults</button>
  <button class="btn wide keep" onclick={() => (restoring = false)}>Keep my macros</button>
</Sheet>

<style>
  .sub {
    padding-top: var(--rr-safe-top);
  }

  .tf {
    width: 100%;
    height: var(--rr-tap);
    padding: 0 var(--rr-space-4);
    border: 0;
    background: transparent;
    font-size: var(--rr-text-body);
  }

  .tf:focus,
  .ta:focus {
    outline: none;
  }

  .group:has(.tf:focus-visible),
  .text-group:has(.ta:focus-visible) {
    box-shadow: inset 0 0 0 2px var(--rr-accent);
  }

  .ta {
    display: block;
    width: 100%;
    padding: var(--rr-space-3) var(--rr-space-4);
    resize: vertical;
    border: 0;
    background: transparent;
    font-size: var(--rr-text-sub);
    line-height: var(--rr-leading-sub);
    text-transform: uppercase;
  }

  .fields {
    display: flex;
    flex-wrap: wrap;
    gap: 0 var(--rr-space-1);
    padding: 0 var(--rr-space-3) var(--rr-space-2);
  }

  .fb {
    display: flex;
    align-items: center;
    min-width: var(--rr-tap);
    height: var(--rr-tap);
    padding: 0;
    font-size: var(--rr-text-caption);
    font-weight: var(--rr-weight-semibold);
  }

  .fb span {
    display: flex;
    align-items: center;
    height: var(--rr-chip);
    padding: 0 var(--rr-space-2);
    border-radius: var(--rr-radius-pill);
    background: var(--rr-fill-bg);
  }

  .fb:focus-visible {
    outline: none;
  }

  .fb:focus-visible span {
    outline: 2px solid var(--rr-accent);
    outline-offset: 1px;
  }

  .sends {
    padding: var(--rr-space-3) var(--rr-space-4);
    font-size: var(--rr-text-sub);
    line-height: var(--rr-leading-sub);
    color: var(--rr-label2);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .mlist {
    padding: 0;
    list-style: none;
  }

  .mrow {
    position: relative;
    display: flex;
    align-items: center;
    min-height: 52px;
    padding-right: var(--rr-space-3);
    background: var(--rr-surface);
    touch-action: pan-y;
  }

  .mrow + .mrow::before {
    content: '';
    position: absolute;
    top: 0;
    right: 0;
    left: var(--rr-tap);
    height: var(--rr-hairline);
    background: var(--rr-sep);
  }

  .mlist.dragging .mrow {
    transition: transform var(--rr-transition);
  }

  .mrow.lifted {
    z-index: 2;
    transition: none;
    box-shadow: 0 6px 20px var(--rr-shadow-thumb);
  }

  .grip {
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: var(--rr-tap);
    height: var(--rr-tap);
    color: var(--rr-label3);
    touch-action: none;
    cursor: grab;
  }

  .ml {
    display: flex;
    flex: 1;
    flex-direction: column;
    justify-content: center;
    min-width: 0;
    min-height: var(--rr-tap);
    padding: var(--rr-space-1) 0;
    color: var(--rr-label);
  }

  .mt {
    font-size: var(--rr-text-body);
  }

  .mx {
    overflow: hidden;
    font-size: var(--rr-text-caption);
    color: var(--rr-label2);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Move up and Move down: for the keyboard and assistive technology; they show while focused. */
  .moves {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }

  .moves:focus-within {
    position: static;
    display: flex;
    width: auto;
    height: auto;
    clip-path: none;
  }

  .move {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--rr-tap);
    height: var(--rr-tap);
    color: var(--rr-accent);
  }

  .move:disabled {
    opacity: 0.35;
  }

  .mrow :global(.row-chevron) {
    flex: none;
    margin-left: var(--rr-space-1);
    color: var(--rr-chev);
  }

  .act {
    width: 100%;
    color: var(--rr-accent);
    text-align: left;
  }

  .danger {
    width: 100%;
    color: var(--rr-tx-text);
    text-align: left;
  }

  .confirm-text {
    margin: var(--rr-space-3) var(--rr-space-1) 0;
    font-size: var(--rr-text-sub);
    line-height: var(--rr-leading-sub);
  }

  .wide {
    display: flex;
    justify-content: center;
    width: 100%;
    margin-top: var(--rr-space-3);
  }

  .keep {
    margin-top: var(--rr-space-2);
    background: transparent;
    color: var(--rr-accent);
  }
</style>
