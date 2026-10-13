<script lang="ts">
  /**
   * Settings › Decode colours: WSJT-X's background colours in priority order, then the text
   * layer, worked before. Each background category has a swatch (opens the colour sheet), a switch
   * and a handle: touch and hold the handle, then drag, as on iOS. Move up and Move down do the
   * same for VoiceOver and keyboards; they show when focused. Every change applies at once.
   * Choosing a preset (WSJT-X or Quiet) offers Undo for 10 s. Custom shows when the colours match
   * neither preset, and cannot be chosen.
   */
  import { tick } from 'svelte';
  import BackLink from '../ui/BackLink.svelte';
  import ColourSheet from '../ui/ColourSheet.svelte';
  import DecodeList, { type DecodeListItem } from '../ui/DecodeList.svelte';
  import Icon from '../ui/Icon.svelte';
  import { href } from '../lib/app/router.svelte';
  import { PRESETS, category, highlightDecode, isBackground, moveBackground, presetHighlights, presetOf, type HighlightEntry, type HighlightId, type PresetId } from '../lib/decode/highlight';
  import { inkFor } from '../lib/decode/highlight-colour';
  import { markDecode } from '../lib/decode/marking';
  import { buildLogIndex } from '../lib/log/worked';
  import { settings, updateSettings } from '../lib/state/settings.svelte';

  /** Touch and hold before a row lifts, as iOS does, ms. */
  const LONG_PRESS_MS = 350;
  const NOTICE_MS = 10_000;

  // The example: decodes on 20m FT8 against a small log, coloured by the operator's settings.
  const SAMPLE_LOG = buildLogIndex(
    [
      ['JA7XVZ', 'QM09', '40m', 'FT8'],
      ['JH1RRT', 'QM09', '20m', 'FT8'],
      ['BH1LKO', 'OM89', '40m', 'FT8'],
      ['VK2AXN', 'OL72', '20m', 'FT4'],
      ['9M2TRX', 'OJ02', '20m', 'FT8'],
      ['4I1LCT', 'PK04', '20m', 'FT8'],
    ].map(([call, gridsquare, band, mode]) => ({ call, gridsquare, band, mode, submode: '' })),
  );
  const SAMPLE_AT = { band: '20m', mode: 'FT8' };

  const me = $derived(settings.callsign || 'K1ABC');
  const example: DecodeListItem[] = $derived.by(() => {
    const rows: [string, number, number, number, boolean][] = [
      [`${me} JA1KXM PM95`, -14, 0.1, 2397, false],
      ['CQ A41ZZ LL93', -4, 0.2, 956, false],
      ['CQ BH1LKO OM89', -7, 0.2, 1959, false],
      ['CQ VR2XMT OL72', -9, 0.1, 1066, false],
      ['CQ JA7XVZ QM09', -13, 0.4, 1803, false],
      ['JA8HCE VK2AXN RR73', -8, 0.1, 1169, false],
      ['CQ 9M2TRX OJ02', -12, 0.3, 1310, false],
      [`JA1KXM ${me} R-14`, 0, 0, 1500, true],
      ['BD7PDP 4I1LCT 73', 5, 0.1, 1084, false],
    ];
    return rows.map(([text, snr_db, dt_s, freq_hz, sent], i) => {
      const decode = { text, snr_db, dt_s, freq_hz };
      const h = highlightDecode({ text, sent }, me, SAMPLE_LOG, SAMPLE_AT, settings.highlights);
      return { kind: 'row' as const, id: `x${i}`, slotStartMs: 0, row: { decode, ...markDecode(decode, me, sent), hl: h.bg, ink: h.ink, time: sent ? '13:14:30' : undefined } };
    });
  });

  const entries = $derived(settings.highlights);
  const backgrounds = $derived(entries.filter(isBackground));
  const layers = $derived(entries.filter((e) => !isBackground(e)));

  function save(next: HighlightEntry[]) {
    void updateSettings({ highlights: next });
  }

  function setOn(id: HighlightId, on: boolean) {
    save(entries.map((e) => (e.id === id ? { ...e, on } : { ...e })));
  }

  // The colour sheet.
  let editing = $state<HighlightId | null>(null);
  let sheetOpen = $state(false);
  const editingEntry = $derived(editing ? (entries.find((e) => e.id === editing) ?? null) : null);

  function openSheet(id: HighlightId) {
    editing = id;
    sheetOpen = true;
  }

  function setColour(colour: string) {
    const id = editing;
    if (id) save(entries.map((e) => (e.id === id ? { ...e, colour } : { ...e })));
  }

  // Order.
  let listEl = $state<HTMLUListElement | null>(null);
  let announce = $state('');
  let drag = $state<{ id: HighlightId; from: number; to: number; dy: number; h: number } | null>(null);

  /** Moves among the background categories; `from` and `to` count them only. */
  function moveTo(from: number, to: number) {
    const id = backgrounds[from].id;
    save(moveBackground(entries, from, to));
    announce = `${category(id).label} moved to ${to + 1} of ${backgrounds.length}.`;
  }

  async function moveBy(i: number, step: -1 | 1) {
    const id = backgrounds[i].id;
    moveTo(i, i + step);
    // The row moved in the page; focus follows it to the same button, or the other one at an end.
    await tick();
    const row = listEl?.querySelector(`[data-id="${id}"]`);
    const same = row?.querySelector<HTMLButtonElement>(step < 0 ? '.move-up' : '.move-down');
    (same && !same.disabled ? same : row?.querySelector<HTMLButtonElement>('.move:not(:disabled)'))?.focus();
  }

  /** Where row `i` sits while a row is dragged: the lifted row follows the finger, the rows it passes make room. */
  function shift(i: number): string | undefined {
    const d = drag;
    if (!d) return undefined;
    if (i === d.from) return `translateY(${d.dy}px)`;
    if (d.from < d.to && i > d.from && i <= d.to) return `translateY(${-d.h}px)`;
    if (d.from > d.to && i >= d.to && i < d.from) return `translateY(${d.h}px)`;
    return undefined;
  }

  /** Pointer handling for a row's handle: touch and hold lifts the row (a mouse lifts it on the first move). */
  function grip(node: HTMLElement) {
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || drag || !listEl) return;
      const id = node.closest('li')?.dataset.id;
      const from = backgrounds.findIndex((x) => x.id === id);
      if (from < 0) return;
      e.preventDefault();
      const rects = [...listEl.children].map((el) => el.getBoundingClientRect());
      const [x0, y0] = [e.clientX, e.clientY];
      const h = rects[from].height;
      let lifted = false;
      const lift = () => {
        lifted = true;
        drag = { id: backgrounds[from].id, from, to: from, dy: 0, h };
        navigator.vibrate?.(10);
      };
      const timer = e.pointerType === 'mouse' ? null : setTimeout(lift, LONG_PRESS_MS);
      const move = (ev: PointerEvent) => {
        if (!lifted) {
          if (e.pointerType === 'mouse' && Math.abs(ev.clientY - y0) > 3) lift();
          else if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > 10) return stop(false);
          if (!lifted) return;
        }
        ev.preventDefault();
        const dy = ev.clientY - y0;
        const centre = rects[from].top + h / 2 + dy;
        let to = from;
        for (let i = from + 1; i < rects.length; i++) if (centre > rects[i].top + rects[i].height / 2) to = i;
        for (let i = from - 1; i >= 0; i--) if (centre < rects[i].top + rects[i].height / 2) to = i;
        drag = { id: backgrounds[from].id, from, to, dy, h };
      };
      const up = () => stop(true);
      const cancel = () => stop(false);
      function stop(commit: boolean) {
        if (timer) clearTimeout(timer);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', cancel);
        const d = drag;
        drag = null;
        if (commit && d && d.to !== d.from) moveTo(d.from, d.to);
      }
      window.addEventListener('pointermove', move, { passive: false });
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', cancel);
    };
    const menu = (e: Event) => e.preventDefault();
    node.addEventListener('pointerdown', down);
    node.addEventListener('contextmenu', menu);
    return () => {
      node.removeEventListener('pointerdown', down);
      node.removeEventListener('contextmenu', menu);
    };
  }

  // Presets, with Undo.
  let notice = $state<{ before: HighlightEntry[]; label: string; seq: number } | null>(null);
  const preset = $derived(presetOf(entries));

  function choose(id: PresetId) {
    const before = $state.snapshot(settings.highlights) as HighlightEntry[];
    save(presetHighlights(id));
    notice = { before, label: PRESETS.find((p) => p.id === id)?.label ?? '', seq: (notice?.seq ?? 0) + 1 };
  }

  function undo() {
    if (notice) save(notice.before);
    notice = null;
  }

  $effect(() => {
    if (!notice) return;
    const t = setTimeout(() => (notice = null), NOTICE_MS);
    return () => clearTimeout(t);
  });
</script>

<section class="screen" aria-labelledby="colours-title">
  <BackLink to={href('settings')} label="Settings" title="Decode colours" id="colours-title" />

  <div class="section">
    <h2 class="section-head" id="preset-head">Preset</h2>
    <div class="group" role="radiogroup" aria-labelledby="preset-head">
      {#each PRESETS as p (p.id)}
        <label class="row pick">
          <input class="visually-hidden" type="radio" name="preset" value={p.id} checked={preset === p.id} onchange={() => choose(p.id)} />
          <span class="row-main"><span class="row-title">{p.label}</span></span>
          {#if preset === p.id}<span class="tick" aria-hidden="true"><Icon name="check" size={20} /></span>{/if}
        </label>
      {/each}
      <label class="row">
        <input class="visually-hidden" type="radio" name="preset" value="custom" checked={preset === 'custom'} disabled />
        <span class="row-main"><span class="row-title">Custom</span></span>
        {#if preset === 'custom'}<span class="tick" aria-hidden="true"><Icon name="check" size={20} /></span>{/if}
      </label>
    </div>
  </div>

  <div class="section">
    <h2 class="section-head">Example</h2>
    <div class="group example" data-testid="colours-example">
      <DecodeList items={example} highlights={entries} label="Example decodes" preview />
    </div>
  </div>

  <div class="section">
    <h2 class="section-head" id="highlight-head">Highlight</h2>
    <ul class="group hl-list" class:dragging={drag !== null} aria-labelledby="highlight-head" bind:this={listEl}>
      {#each backgrounds as e, i (e.id)}
        {@const c = category(e.id)}
        <li class="hl-row" class:lifted={drag?.id === e.id} style:transform={shift(i)} data-id={e.id}>
          <button type="button" class="swatch rr-hl hl-background" style:--rr-hl={e.colour} aria-label="Change colour: {c.label}" onclick={() => openSheet(e.id)}>
            <span class="chip" aria-hidden="true"></span>
          </button>
          <label class="hl-main">
            <span class="row-main"><span class="row-title">{c.label}</span>{#if c.sub}<span class="row-sub">{c.sub}</span>{/if}</span>
            <input class="switch" type="checkbox" role="switch" aria-label={c.label} checked={e.on} onchange={(ev) => setOn(e.id, ev.currentTarget.checked)} />
          </label>
          <span class="grip" aria-hidden="true" {@attach grip}><Icon name="grip" size={22} /></span>
          <span class="moves">
            <button type="button" class="move move-up" aria-label="Move {c.label} up" disabled={i === 0} onclick={() => void moveBy(i, -1)}><Icon name="chevup" size={18} /></button>
            <button type="button" class="move move-down" aria-label="Move {c.label} down" disabled={i === backgrounds.length - 1} onclick={() => void moveBy(i, 1)}><Icon name="chevdown" size={18} /></button>
          </span>
        </li>
      {/each}
    </ul>
    <p class="section-foot">The first matching category from the top sets the background.</p>
  </div>

  <div class="section">
    <h2 class="section-head" id="text-head">Text</h2>
    <ul class="group hl-list text-list" aria-labelledby="text-head">
      {#each layers as e (e.id)}
        {@const c = category(e.id)}
        {@const ink = inkFor(e.colour, null)}
        <li class="hl-row" data-id={e.id}>
          <button type="button" class="swatch rr-ink hl-ink" style:--rr-ink-light={ink.light} style:--rr-ink-dark={ink.dark} aria-label="Change colour: {c.label}" onclick={() => openSheet(e.id)}>
            <span class="chip" aria-hidden="true">Aa</span>
          </button>
          <label class="hl-main end">
            <span class="row-main"><span class="row-title">{c.label}</span>{#if c.sub}<span class="row-sub">{c.sub}</span>{/if}</span>
            <input class="switch" type="checkbox" role="switch" aria-label={c.label} checked={e.on} onchange={(ev) => setOn(e.id, ev.currentTarget.checked)} />
          </label>
        </li>
      {/each}
    </ul>
  </div>

  <span class="visually-hidden" role="status">{announce}</span>
  <div class="notice" role="status">
    {#if notice}
      <div class="toast" data-testid="colours-notice">
        <span class="msg">{notice.label} preset applied.</span>
        <button type="button" class="act" aria-label="Undo the {notice.label} preset" onclick={undo}>Undo</button>
      </div>
    {/if}
  </div>
</section>

<ColourSheet bind:open={sheetOpen} entry={editingEntry} onpick={setColour} />

<style>
  .example {
    padding: 0;
  }

  .hl-list {
    margin: 0;
    padding: 0;
    overflow: visible;
    list-style: none;
  }

  .hl-row {
    position: relative;
    display: flex;
    gap: var(--rr-space-3);
    align-items: center;
    min-height: calc(var(--rr-tap) + var(--rr-space-3));
    padding-left: var(--rr-space-4);
    border-radius: var(--rr-radius-xl);
    background: var(--rr-surface);
  }

  .hl-row + .hl-row::before {
    content: '';
    position: absolute;
    top: 0;
    right: 0;
    left: calc(var(--rr-space-4) + var(--rr-row-icon) + var(--rr-space-3));
    height: var(--rr-hairline);
    background: var(--rr-sep-strong);
    transform: scaleY(0.5);
    transform-origin: 0 0;
  }

  .dragging .hl-row {
    transition: transform var(--rr-transition);
  }

  .dragging .hl-row::before {
    display: none;
  }

  .hl-row.lifted {
    z-index: 1;
    box-shadow: 0 6px 20px var(--rr-shadow-thumb);
    transition: none;
  }

  .swatch {
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: var(--rr-tap);
    height: var(--rr-tap);
    margin: 0 calc((var(--rr-row-icon) - var(--rr-tap)) / 2);
    border-radius: var(--rr-radius-l);
  }

  .swatch:focus-visible {
    outline: 2px solid var(--rr-accent);
    outline-offset: -2px;
  }

  .chip {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    width: var(--rr-row-icon);
    height: var(--rr-row-icon);
    border-radius: var(--rr-radius-m);
    box-shadow: inset 0 0 0 var(--rr-hairline) var(--rr-sep-strong);
    font-size: var(--rr-text-foot);
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

  .hl-main {
    display: flex;
    flex: 1;
    gap: var(--rr-space-3);
    align-items: center;
    min-width: 0;
    min-height: calc(var(--rr-tap) + var(--rr-space-3));
    padding: var(--rr-space-2) 0;
    cursor: pointer;
  }

  /* A row with no handle ends 16 pt from the group's edge. */
  .hl-main.end {
    padding-right: var(--rr-space-4);
  }

  .grip {
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: var(--rr-tap);
    height: var(--rr-tap);
    color: var(--rr-chev);
    cursor: grab;
    touch-action: none;
    user-select: none;
    -webkit-touch-callout: none;
  }

  .dragging .grip {
    cursor: grabbing;
  }

  /* Move up and Move down: out of sight until focused, then over the switch and handle. */
  .moves {
    position: absolute;
    top: 0;
    left: 0;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  .moves:focus-within {
    inset: 0 0 0 auto;
    display: flex;
    gap: var(--rr-space-1);
    align-items: center;
    width: auto;
    height: auto;
    padding: 0 var(--rr-space-1);
    overflow: visible;
    clip-path: none;
    border-radius: var(--rr-radius-xl);
    background: var(--rr-surface);
  }

  .move {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--rr-tap);
    height: var(--rr-tap);
    border-radius: var(--rr-radius-l);
    color: var(--rr-accent);
  }

  .move:focus-visible {
    outline: 2px solid var(--rr-accent);
    outline-offset: -2px;
  }

  .move:disabled {
    opacity: 0.35;
  }

  .pick {
    cursor: pointer;
  }

  .pick:has(:focus-visible) {
    box-shadow: inset 0 0 0 2px var(--rr-accent);
  }

  .tick {
    flex: none;
    color: var(--rr-accent);
  }


  .notice {
    position: sticky;
    bottom: var(--rr-space-4);
    margin-top: var(--rr-space-4);
  }

  .toast {
    display: flex;
    gap: var(--rr-space-2);
    align-items: center;
    min-height: var(--rr-tap);
    margin: 0 var(--rr-space-4);
    padding: var(--rr-space-1) var(--rr-space-1) var(--rr-space-1) var(--rr-space-4);
    border-radius: var(--rr-radius-l);
    background: var(--rr-toast);
    color: var(--rr-toast-text);
    font-size: var(--rr-text-row);
    line-height: var(--rr-leading-row);
    letter-spacing: var(--rr-tracking-tight);
  }

  .msg {
    flex: 1;
    min-width: 0;
  }

  .act {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    min-width: var(--rr-tap);
    min-height: var(--rr-tap);
    padding: 0 var(--rr-space-2);
    color: var(--rr-toast-link);
    font-weight: var(--rr-weight-bold);
  }
</style>
