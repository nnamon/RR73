<script lang="ts" module>
  import type { ListItem } from '../lib/decode/list';

  export type DecodeListItem = ListItem;

  /** A second tap on the same row within this time is a double-tap, ms. */
  export const DOUBLE_TAP_MS = 350;
</script>

<script lang="ts">
  /**
   * Band activity: 30 pt monospace rows (SNR, DT, Hz, message) under a 22 pt bar per slot,
   * coloured as in WSJT-X by the first matching decode colour (Settings › Decode colours): a
   * 4 px bar and a tint. Worked before greys the text over any tint. The colours ride on the row as
   * classes, data-hl and data-ink, so the markup can change without touching the matcher. The
   * callsign of a CQ, a message to you or what you sent is bold. Slot bars alternate slate (even)
   * and blue (odd).
   *
   * A tap selects a row (or clears the selection, on the selected row), a double-tap calls, and
   * touch and hold opens the station's details. `preview` draws the rows without actions, for the
   * example in Settings.
   */
  import { dt, snr } from '../lib/clock/format';
  import { category, defaultHighlights, type HighlightEntry, type HighlightId } from '../lib/decode/highlight';
  import { inkFor } from '../lib/decode/highlight-colour';
  import { splitKey, type DecodeRowData, type TextParts } from '../lib/decode/marking';

  type RowItem = Extract<DecodeListItem, { kind: 'row' }>;

  let {
    items,
    label = 'Decodes',
    selectedId = null,
    highlights = defaultHighlights(),
    preview = false,
    onselect,
    oncall,
    ondetail,
  }: {
    items: DecodeListItem[];
    label?: string;
    selectedId?: string | null;
    /** Decode colours, for each row's category colour. */
    highlights?: readonly HighlightEntry[];
    preview?: boolean;
    onselect?: (item: RowItem) => void;
    oncall?: (item: RowItem) => void;
    ondetail?: (item: RowItem) => void;
  } = $props();

  const MARK_TEXT = { cq: 'calling CQ', me: 'to you', sent: 'you sent' } as const;
  /** Categories the mark already reads out. */
  const SAID: readonly HighlightId[] = ['cq', 'myCall', 'sent'];
  const HOLD_MS = 500;

  const colours = $derived(new Map(highlights.map((e) => [e.id, e.colour])));

  function spoken(r: DecodeRowData): string {
    const parts = [
      r.time ? `${r.time} UTC` : `${snr(r.decode.snr_db)} dB, DT ${dt(r.decode.dt_s)} s`,
      `${Math.round(r.decode.freq_hz)} Hz`,
      r.decode.text,
      r.mark ? MARK_TEXT[r.mark] : '',
      r.hl && !SAID.includes(r.hl) ? category(r.hl).spoken : '',
      r.ink ? category(r.ink).spoken : '',
      r.badge?.text ?? '',
      r.meta ?? '',
    ];
    return parts.filter(Boolean).join(', ');
  }

  function rowClass(r: DecodeRowData, selected: boolean): string {
    const bg = !!r.hl && colours.has(r.hl);
    const ink = !!r.ink && colours.has(r.ink);
    return ['dr', r.mark ? `k-${r.mark}` : '', r.worked ? 'worked' : '', bg ? 'rr-hl hl-background' : '', ink ? 'rr-ink hl-ink' : '', selected ? 'sel' : ''].filter(Boolean).join(' ');
  }

  // Text colours per pair of text colour and tint, worked out once each (highlight-colour.ts).
  const inks = new Map<string, { light: string; dark: string }>();
  function inkOf(r: DecodeRowData): { light: string; dark: string } | null {
    const ink = r.ink ? colours.get(r.ink) : undefined;
    if (!ink) return null;
    const bg = r.hl ? (colours.get(r.hl) ?? null) : null;
    const key = `${ink}${bg ?? ''}`;
    let v = inks.get(key);
    if (!v) inks.set(key, (v = inkFor(ink, bg)));
    return v;
  }

  let press: { id: string; x: number; y: number; held: boolean; timer: ReturnType<typeof setTimeout> } | null = null;
  let lastTap: { id: string; at: number } | null = null;

  function down(e: PointerEvent, item: RowItem) {
    if (press) clearTimeout(press.timer);
    const p = { id: item.id, x: e.clientX, y: e.clientY, held: false, timer: setTimeout(() => {
      p.held = true;
      lastTap = null;
      ondetail?.(item);
    }, HOLD_MS) };
    press = p;
  }

  function move(e: PointerEvent) {
    if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) clearTimeout(press.timer);
  }

  function up() {
    if (press) clearTimeout(press.timer);
  }

  function click(e: MouseEvent, item: RowItem) {
    if (press?.id === item.id && press.held) {
      e.preventDefault();
      press = null;
      return;
    }
    press = null;
    const now = performance.now();
    if (lastTap?.id === item.id && now - lastTap.at < DOUBLE_TAP_MS) {
      lastTap = null;
      oncall?.(item);
      return;
    }
    lastTap = { id: item.id, at: now };
    onselect?.(item);
  }
</script>

{#snippet cells(r: DecodeRowData, t: TextParts)}
  {#if r.mark === 'sent'}
    <span class="c-db" aria-hidden="true">Tx</span>
    <span class="c-dt" aria-hidden="true"></span>
  {:else}
    <span class="c-db" aria-hidden="true">{snr(r.decode.snr_db)}</span>
    <span class="c-dt" aria-hidden="true">{dt(r.decode.dt_s)}</span>
  {/if}
  <span class="c-hz" aria-hidden="true">{Math.round(r.decode.freq_hz)}</span>
  <span class="c-msg" aria-hidden="true">{t.before}{#if t.bold}<b>{t.bold}</b>{/if}{t.after}</span>
  {#if r.badge}
    <span class="badge {r.badge.tone}" aria-hidden="true">{r.badge.text}</span>
  {:else if r.meta}
    <span class="c-meta" aria-hidden="true">{r.meta}</span>
  {/if}
{/snippet}

<ul class="list" aria-label={label}>
  {#each items as item (item.id)}
    {#if item.kind === 'header'}
      <li class="slot-bar {item.parity}" data-ms={item.ms}>
        <span class="visually-hidden">{item.text}, {item.parity} slot</span>
        <span class="st" aria-hidden="true">{item.time}</span>
        <span class="sd" aria-hidden="true">{item.detail}</span>
        <span class="par" aria-hidden="true">{item.parity === 'even' ? 'Even' : 'Odd'}</span>
      </li>
    {:else}
      {@const r = item.row}
      {@const t = splitKey(r.decode.text, r.key)}
      {@const colour = r.hl ? (colours.get(r.hl) ?? null) : null}
      {@const ink = inkOf(r)}
      <li class="dr-item">
        {#if preview}
          <div class={rowClass(r, false)} style:--rr-hl={colour} style:--rr-ink-light={ink?.light} style:--rr-ink-dark={ink?.dark} data-hl={r.hl ?? undefined} data-ink={r.ink ?? undefined}>
            <span class="visually-hidden">{spoken(r)}</span>
            {@render cells(r, t)}
          </div>
        {:else}
          <button
            type="button"
            class={rowClass(r, selectedId === item.id)}
            style:--rr-hl={colour}
            style:--rr-ink-light={ink?.light}
            style:--rr-ink-dark={ink?.dark}
            data-hl={r.hl ?? undefined}
            data-ink={r.ink ?? undefined}
            aria-label={spoken(r)}
            aria-pressed={selectedId === item.id}
            onpointerdown={(e) => down(e, item)}
            onpointermove={move}
            onpointerup={up}
            onpointercancel={up}
            oncontextmenu={(e) => e.preventDefault()}
            onclick={(e) => click(e, item)}
          >
            {@render cells(r, t)}
          </button>
        {/if}
      </li>
    {/if}
  {/each}
</ul>

<style>
  .list {
    margin: 0;
    padding: 0;
  }

  .slot-bar {
    display: flex;
    gap: var(--rr-space-2);
    align-items: center;
    height: var(--rr-slot-bar);
    padding: 0 var(--rr-space-3);
    border-top: var(--rr-slot-rule) solid var(--rr-slot-even-rule);
    background: var(--rr-slot-even);
    color: var(--rr-slot-even-text);
    font-size: var(--rr-text-caption);
    font-weight: var(--rr-weight-semibold);
    line-height: var(--rr-leading-caption);
    letter-spacing: 0;
    white-space: nowrap;
  }

  .slot-bar.odd {
    border-top-color: var(--rr-slot-odd-rule);
    background: var(--rr-slot-odd);
    color: var(--rr-slot-odd-text);
  }

  .slot-bar .st,
  .slot-bar .par {
    color: var(--rr-slot-even-strong);
  }

  .slot-bar.odd .st,
  .slot-bar.odd .par {
    color: var(--rr-slot-odd-strong);
  }

  .slot-bar .st {
    font-family: var(--rr-mono);
    font-size: var(--rr-text-foot);
    font-weight: var(--rr-weight-bold);
  }

  .slot-bar .sd {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .slot-bar .par {
    margin-left: auto;
    font-size: var(--rr-text-tag);
    font-weight: var(--rr-weight-bold);
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .dr-item {
    position: relative;
  }

  .dr {
    position: relative;
    display: grid;
    grid-template-columns: 30px 28px 38px minmax(0, 1fr) auto;
    column-gap: var(--rr-space-2);
    align-items: center;
    width: 100%;
    height: var(--rr-row-decode);
    padding: 0 var(--rr-space-3);
    font-family: var(--rr-mono);
    font-size: var(--rr-text-decode);
    line-height: var(--rr-leading-row);
    letter-spacing: 0;
    text-align: left;
    white-space: nowrap;
    user-select: none;
    -webkit-touch-callout: none;
  }

  .dr::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: var(--rr-mark-bar);
  }

  .dr-item + .dr-item .dr::before {
    content: '';
    position: absolute;
    top: 0;
    right: 0;
    left: var(--rr-space-3);
    height: var(--rr-hairline);
    background: var(--rr-sep-strong);
    transform: scaleY(0.5);
    transform-origin: 0 0;
  }

  /* Decode colours: --rr-hl-bg and --rr-hl-ink come from .rr-hl in tokens.css. */
  .dr.hl-background {
    background: var(--rr-hl-bg);
  }

  .dr.hl-background::after {
    background: var(--rr-hl);
  }

  /* After the decode colours, so a selected row shows as selected. */
  .dr.sel {
    background: var(--rr-sel-tint);
    box-shadow: inset 0 0 0 2px var(--rr-accent-fill);
  }

  .c-db,
  .c-dt,
  .c-hz {
    color: var(--rr-label2);
    text-align: right;
  }

  .c-msg {
    min-width: 0;
    overflow: hidden;
    white-space: pre;
    text-overflow: ellipsis;
  }

  .c-msg b {
    font-weight: var(--rr-weight-bold);
  }

  .worked .c-msg {
    color: var(--rr-label2);
  }

  /* On a tint, every column takes the label colour, which keeps 4.5:1 on any decode colour. */
  .hl-background .c-db,
  .hl-background .c-dt,
  .hl-background .c-hz,
  .hl-background .c-msg,
  .hl-background .c-meta {
    color: var(--rr-label);
  }

  /* Worked before: after the tint's label colour, so it wins over it. */
  .hl-ink .c-db,
  .hl-ink .c-dt,
  .hl-ink .c-hz,
  .hl-ink .c-msg,
  .hl-ink .c-meta {
    color: var(--rr-hl-ink);
  }

  .hl-ink.sel .c-db,
  .hl-ink.sel .c-dt,
  .hl-ink.sel .c-hz,
  .hl-ink.sel .c-msg,
  .hl-ink.sel .c-meta {
    color: var(--rr-label);
  }

  .c-meta {
    font-family: var(--rr-sans);
    font-size: var(--rr-text-caption);
    font-weight: var(--rr-weight-semibold);
    line-height: var(--rr-leading-caption);
    letter-spacing: 0;
    color: var(--rr-label2);
  }

  .badge {
    height: 20px;
    font-family: var(--rr-sans);
    padding: 0 var(--rr-space-1-5);
    border-radius: var(--rr-radius-s);
    font-size: var(--rr-text-caption);
    font-weight: var(--rr-weight-bold);
    line-height: 20px;
    letter-spacing: 0;
    color: var(--rr-on-strong);
    white-space: nowrap;
  }

  .badge.teal {
    background: var(--rr-teal);
  }

  .badge.mag {
    background: var(--rr-mag);
  }

  .badge.bad {
    background: var(--rr-tx-fill);
    color: var(--rr-on-fill);
  }

  .badge.muted {
    background: var(--rr-fill2);
    color: var(--rr-label2);
  }
</style>
