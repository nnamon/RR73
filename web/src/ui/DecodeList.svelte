<script lang="ts" module>
  import type { ListItem } from '../lib/decode/list';

  export type DecodeListItem = ListItem;

  /** A second tap on the same row within this time is a double-tap, ms. */
  export const DOUBLE_TAP_MS = 350;
</script>

<script lang="ts">
  /**
   * Band activity: 32 pt rows under a 22 pt bar per slot. Each row leads with the message in
   * 16 pt semibold, the calling station of a CQ a weight heavier, and ends with SNR and audio
   * frequency in 12 pt grey ("−12 dB · 766 Hz"); DT is in the station's details. Rows are
   * coloured as in WSJT-X by the first matching decode colour (Settings › Decode colours): a 4 px
   * bar and a tint. Worked before greys the text over any tint. The colours ride on the row as
   * classes, data-hl and data-ink, so the markup can change without touching the matcher. Rows of
   * slots older than the newest slot with decodes fade: grey text, a lighter tint. Slot bars alternate
   * slate (even) and blue (odd); a run of slots with no decodes has one grey bar with its span.
   *
   * A message to you has a solid red edge and heavier text, over its decode colour. During a QSO,
   * rows unrelated to the station being worked dim (lib/decode/focus.ts); a selected row does not.
   *
   * A CQ row names the caller's country before the numbers ("Australia"), once the country file
   * has loaded. The country gives way to the message: it ends in an ellipsis when short of room
   * and drops out when there is none.
   *
   * Our own transmission is a row of its own: Next with a countdown to its slot (grey), Sending
   * with a red progress line while on air, then Sent in its slot.
   *
   * A tap selects a row (or clears the selection, on the selected row), a double-tap calls, and
   * touch and hold opens the station's details. The Next row takes no gestures. `preview` draws
   * the rows without actions, for the example in Settings. With a mouse, a click selects, a
   * double-click calls and a right-click opens the details; outside compact width the row under
   * the pointer shows it.
   */
  import { dt, snr } from '../lib/clock/format';
  import { cqCountry } from '../lib/decode/country';
  import { isLost, type LostMark } from '../lib/decode/lost';
  import { queueSpoken, queueTag, type QueueMark } from '../lib/decode/queue';
  import { category, defaultHighlights, type HighlightEntry, type HighlightId } from '../lib/decode/highlight';
  import { inkFor, oldInkFor } from '../lib/decode/highlight-colour';
  import { outText, type RowItem } from '../lib/decode/list';
  import { splitKey, type DecodeRowData, type TextParts } from '../lib/decode/marking';
  import type { DxccIndex } from '../lib/reference';

  let {
    items,
    label = 'Decodes',
    selectedId = null,
    highlights = defaultHighlights(),
    preview = false,
    nowMs = 0,
    countries = null,
    lost = [],
    queue = [],
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
    /** Now, UTC ms: the Next row's countdown and the Sending row's progress. */
    nowMs?: number;
    /** The country file, for the caller's country on CQ rows; null until it has loaded. */
    countries?: DxccIndex | null;
    /** Stations we called that answered another station: their rows read Lost where a CQ row has its country. */
    lost?: readonly LostMark[];
    /** Callers waiting while we call CQ with Repeat CQ on: their latest message to us reads Next, 2nd or Dupe there too. */
    queue?: readonly QueueMark[];
    onselect?: (item: RowItem) => void;
    oncall?: (item: RowItem) => void;
    ondetail?: (item: RowItem) => void;
  } = $props();

  const MARK_TEXT = { cq: 'calling CQ', me: 'to you', sent: 'sent' } as const;
  /** Categories the mark already reads out. */
  const SAID: readonly HighlightId[] = ['cq', 'myCall', 'sent'];
  const HOLD_MS = 500;

  const colours = $derived(new Map(highlights.map((e) => [e.id, e.colour])));

  type Out = ReturnType<typeof outText>;

  function spoken(item: RowItem, o: Out | null, country: string | null = null, lostRow = false, queued: string | null = null): string {
    const r = item.row;
    const parts = [
      o ? o.tag.replace(' · :', ', :') : '',
      r.time ? `${r.time} UTC` : `${snr(r.decode.snr_db)} dB, DT ${dt(r.decode.dt_s)} s`,
      o ? o.meta : `${Math.round(r.decode.freq_hz)} Hz`,
      r.decode.text,
      // Our own rows say Next, Sending or Sent in their tag.
      r.mark && !item.out ? MARK_TEXT[r.mark] : '',
      country ?? '',
      lostRow ? 'lost, answered another station' : '',
      queued ? queueSpoken(queued) : '',
      r.hl && !SAID.includes(r.hl) ? category(r.hl).spoken : '',
      r.ink ? category(r.ink).spoken : '',
      r.badge?.text ?? '',
      r.meta ?? '',
    ];
    return parts.filter(Boolean).join(', ');
  }

  function rowClass(item: RowItem, selected: boolean): string {
    const r = item.row;
    const bg = !!r.hl && colours.has(r.hl);
    const ink = !!r.ink && colours.has(r.ink);
    return [
      'dr',
      r.mark ? `k-${r.mark}` : '',
      r.worked ? 'worked' : '',
      bg ? 'rr-hl hl-background' : '',
      ink ? 'rr-ink hl-ink' : '',
      item.old ? 'old' : '',
      item.out ? `out ${item.out.stage}` : '',
      item.toYou ? 'to-you' : '',
      item.dim ? 'dim' : '',
      selected ? 'sel' : '',
    ]
      .filter(Boolean)
      .join(' ');
  }

  // Text colours per pair of text colour and tint, worked out once each (highlight-colour.ts).
  const inks = new Map<string, { light: string; dark: string }>();
  function inkOf(item: RowItem): { light: string; dark: string } | null {
    const r = item.row;
    const bg = r.hl ? (colours.get(r.hl) ?? null) : null;
    if (item.old && bg) {
      const key = `old${bg}`;
      let v = inks.get(key);
      if (!v) inks.set(key, (v = oldInkFor(bg)));
      return v;
    }
    const ink = r.ink ? colours.get(r.ink) : undefined;
    if (!ink) return null;
    const key = `${ink}${bg ?? ''}`;
    let v = inks.get(key);
    if (!v) inks.set(key, (v = inkFor(ink, bg)));
    return v;
  }

  let press: { id: string; x: number; y: number; held: boolean; timer: ReturnType<typeof setTimeout> } | null = null;
  let lastTap: { id: string; at: number } | null = null;
  let pointerType = '';

  function down(e: PointerEvent, item: RowItem) {
    pointerType = e.pointerType;
    if (e.button !== 0) return;
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

{#snippet cells(r: DecodeRowData, t: TextParts, o: Out | null, next: boolean, country: string | null, lostRow = false, queued: string | null = null)}
  {#if o}<span class="c-tag" aria-hidden="true">{o.tag}</span>{/if}
  <span class="c-msg" aria-hidden="true">{t.before}{#if t.bold}<b>{t.bold}</b>{/if}{t.after}</span>
  {#if r.badge}
    <span class="badge {r.badge.tone}" aria-hidden="true">{r.badge.text}</span>
  {:else if r.meta}
    <span class="c-meta" aria-hidden="true">{r.meta}</span>
  {/if}
  {#if o}
    <span class="c-num" aria-hidden="true"><span class={next ? 'c-when' : 'c-hz'}>{o.meta}</span></span>
    {#if o.progress !== null}<i class="prog" style:width="{o.progress * 100}%" aria-hidden="true"></i>{/if}
  {:else}
    {#if country}<span class="c-country" aria-hidden="true"><span>{country}</span></span>{:else if lostRow}<span class="c-lost" aria-hidden="true">Lost</span>{:else if queued}<span class="c-queue" class:next={queued === 'Next'} class:dupe={queued === 'Dupe'} aria-hidden="true">{queued}</span>{/if}
    <span class="c-num" aria-hidden="true"><span class="c-db">{snr(r.decode.snr_db)} dB</span> · <span class="c-hz">{Math.round(r.decode.freq_hz)} Hz</span></span>
  {/if}
{/snippet}

<ul class="list" aria-label={label}>
  {#each items as item (item.id)}
    {#if item.kind === 'header'}
      <li class="slot-bar {item.parity ?? 'quiet'}" data-ms={item.ms}>
        <span class="visually-hidden">{item.parity ? `${item.text}, ${item.parity} slot` : item.text}</span>
        <span class="st" aria-hidden="true">{item.time}</span>
        {#if item.until}
          <span class="to" aria-hidden="true">to</span>
          <span class="st" aria-hidden="true">{item.until}</span>
        {/if}
        <span class="sd" aria-hidden="true">{item.detail}</span>
        {#if item.parity}
          <span class="par" aria-hidden="true">{item.parity === 'even' ? 'Even' : 'Odd'}</span>
        {/if}
      </li>
    {:else}
      {@const r = item.row}
      {@const t = splitKey(r.decode.text, r.key)}
      {@const colour = r.hl ? (colours.get(r.hl) ?? null) : null}
      {@const ink = inkOf(item)}
      {@const o = item.out ? outText(item.out, item.slotStartMs, r.decode.freq_hz, nowMs) : null}
      {@const next = item.out?.stage === 'next'}
      {@const country = item.out ? null : cqCountry(r, countries)}
      {@const lostRow = !item.out && isLost(r.decode.text, item.slotStartMs, lost)}
      {@const queued = !item.out && r.mark === 'me' ? queueTag(r.decode.text, item.slotStartMs, queue) : null}
      <li class="dr-item">
        {#if preview || next}
          <div
            class={rowClass(item, false)}
            style:--rr-hl={colour}
            style:--rr-ink-light={ink?.light}
            style:--rr-ink-dark={ink?.dark}
            data-hl={r.hl ?? undefined}
            data-ink={r.ink ?? undefined}
            data-testid={next ? 'next-row' : undefined}
          >
            <span class="visually-hidden">{spoken(item, o)}</span>
            {@render cells(r, t, o, next, country, lostRow, queued)}
          </div>
        {:else}
          <button
            type="button"
            class={rowClass(item, selectedId === item.id)}
            style:--rr-hl={colour}
            style:--rr-ink-light={ink?.light}
            style:--rr-ink-dark={ink?.dark}
            data-hl={r.hl ?? undefined}
            data-ink={r.ink ?? undefined}
            aria-label={spoken(item, o, country, lostRow, queued)}
            aria-pressed={selectedId === item.id}
            onpointerdown={(e) => down(e, item)}
            onpointermove={move}
            onpointerup={up}
            onpointercancel={up}
            oncontextmenu={(e) => {
              e.preventDefault();
              if (pointerType === 'mouse') ondetail?.(item);
            }}
            onclick={(e) => click(e, item)}
          >
            {@render cells(r, t, o, false, country, lostRow, queued)}
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

  /* A run of slots with no decodes: one grey bar with its span and no parity. */
  .slot-bar.quiet {
    border-top-color: var(--rr-slot-quiet-rule);
    background: var(--rr-slot-quiet);
    color: var(--rr-slot-quiet-text);
  }

  .slot-bar.quiet .st {
    color: var(--rr-slot-quiet-strong);
  }

  .dr-item {
    position: relative;
  }

  .dr {
    position: relative;
    display: flex;
    gap: var(--rr-space-2);
    align-items: center;
    width: 100%;
    height: var(--rr-row-decode);
    padding: 0 var(--rr-space-3) 0 calc(var(--rr-space-3) + var(--rr-space-half));
    overflow: hidden;
    font-family: var(--rr-sans);
    letter-spacing: 0;
    text-align: left;
    white-space: nowrap;
    user-select: none;
    -webkit-touch-callout: none;
    transition: opacity var(--rr-transition);
  }

  .dr::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: var(--rr-mark-bar);
  }

  @media (hover: hover) {
    :global(:root:not([data-size='compact'])) button.dr:hover {
      background-image: linear-gradient(var(--rr-hover), var(--rr-hover));
    }
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

  /* The message first, in proportional type; the calling station of a CQ a weight heavier. */
  .c-msg {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    font-size: var(--rr-text-callout);
    font-weight: var(--rr-weight-semibold);
    line-height: var(--rr-leading-row);
    color: var(--rr-label);
    white-space: pre;
    text-overflow: ellipsis;
  }

  .c-msg b {
    font-weight: inherit;
  }

  .k-cq .c-msg b {
    font-weight: var(--rr-weight-bold);
  }

  /* SNR and frequency on the right, in one column wide enough for "−24 dB · 2999 Hz" in tabular
     digits, so the numbers start at one x on every row. */
  .c-num {
    flex: none;
    min-width: 9em;
    font-size: var(--rr-text-caption);
    line-height: var(--rr-leading-caption);
    font-variant-numeric: tabular-nums;
    color: var(--rr-label3);
    text-align: right;
  }

  .worked .c-msg {
    color: var(--rr-label2);
  }

  /* Decode colours: --rr-hl-bg and --rr-hl-ink come from .rr-hl in tokens.css. */
  .dr.hl-background {
    background: var(--rr-hl-bg);
  }

  .dr.hl-background::after {
    background: var(--rr-hl);
  }

  /* On a tint, all text takes the label colour, which keeps 4.5:1 on any decode colour. */
  .hl-background .c-num,
  .hl-background .c-msg,
  .hl-background .c-meta {
    color: var(--rr-label);
  }

  /* Worked before: after the tint's label colour, so it wins over it. */
  .hl-ink .c-num,
  .hl-ink .c-msg,
  .hl-ink .c-meta {
    color: var(--rr-hl-ink);
  }

  /* Our transmission: a tag before the message; Next is grey with a countdown in the accent. */
  .c-tag {
    flex: none;
    font-size: var(--rr-text-tag);
    font-weight: var(--rr-weight-bold);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--rr-label2);
  }

  .hl-background .c-tag {
    color: color-mix(in srgb, var(--rr-hl) 35%, var(--rr-label));
  }

  .dr.next {
    background: var(--rr-fill);
  }

  .c-when {
    font-weight: var(--rr-weight-semibold);
    color: var(--rr-accent);
  }

  /* On air: a red line along the bottom, growing to the end of the transmission. */
  .prog {
    position: absolute;
    bottom: 0;
    left: 0;
    height: 3px;
    background: var(--rr-tx);
    transition: width 200ms linear;
  }

  @media (prefers-reduced-motion: reduce) {
    .prog,
    .dr {
      transition: none;
    }
  }

  /* Older slots fade: grey text, a lighter tint, its text grey as far as 4.5:1 allows. */
  .dr.old .c-msg,
  .dr.old .c-num,
  .dr.old .c-meta,
  .dr.old .c-tag {
    color: var(--rr-old-text);
  }

  .dr.old.hl-background {
    background: var(--rr-hl-bg-old);
  }

  .dr.old.hl-background::after {
    opacity: 0.6;
  }

  .dr.old.hl-background .c-msg,
  .dr.old.hl-background .c-num,
  .dr.old.hl-background .c-meta,
  .dr.old.hl-background .c-tag {
    color: var(--rr-hl-old-ink);
  }

  /* A message to you: a solid red edge over the decode colour's bar, and heavier text. */
  .dr.to-you::after,
  .dr.old.hl-background.to-you::after {
    background: var(--rr-to-you-edge);
    opacity: 1;
  }

  .dr.to-you .c-msg {
    font-weight: var(--rr-weight-heavy);
  }

  /* During a QSO, rows unrelated to the station being worked dim. A selected row stays clear. */
  .dr.dim:not(.sel) {
    opacity: var(--rr-focus-dim);
  }

  /* After the decode colours and the fading, so a selected row shows as selected. */
  .dr.sel,
  .dr.old.sel {
    background: var(--rr-sel-tint);
    box-shadow: inset 0 0 0 2px var(--rr-accent-fill);
  }

  .dr.sel .c-msg,
  .dr.sel .c-num,
  .dr.sel .c-meta,
  .dr.old.sel .c-msg,
  .dr.old.sel .c-num,
  .dr.old.sel .c-meta {
    color: var(--rr-label);
  }

  .c-meta {
    flex: none;
    font-size: var(--rr-text-caption);
    font-weight: var(--rr-weight-semibold);
    line-height: var(--rr-leading-caption);
    letter-spacing: 0;
    color: var(--rr-label2);
  }

  .badge {
    flex: none;
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

  /*
   * The caller's country on a CQ row. The message keeps its whole width and the country takes
   * what is left, ending in an ellipsis; under 3 em it drops out. Its negative margin takes back
   * the row's gap, so a country with no room leaves the message the width it has without one.
   */
  .dr:has(.c-country) .c-msg {
    flex: 0 1 auto;
  }

  .c-country {
    flex: 1 1 0;
    min-width: 0;
    margin-left: calc(-1 * var(--rr-space-2));
    container-type: inline-size;
    font-size: var(--rr-text-caption);
    font-weight: var(--rr-weight-medium);
    line-height: var(--rr-leading-caption);
    color: var(--rr-label2);
    text-align: right;
  }

  .c-country > span {
    display: block;
    padding-left: var(--rr-space-2);
    overflow: hidden;
    text-overflow: ellipsis;
  }

  @container (width < 3em) {
    .c-country > span {
      display: none;
    }
  }

  /* Colours as for the numbers: on a tint, worked before, faded, selected. */
  .hl-background .c-country {
    color: var(--rr-label);
  }

  /* A station we were calling, answering another station: a small red Lost where a CQ row has its country. */
  .c-lost {
    flex: none;
    font-size: var(--rr-text-caption);
    font-weight: var(--rr-weight-bold);
    line-height: var(--rr-leading-caption);
    color: var(--rr-tx-text);
  }

  /* A caller waiting while we call CQ: Next in the tint, later places and Dupe in grey, where a CQ row has its country. */
  .c-queue {
    flex: none;
    font-size: var(--rr-text-caption);
    font-weight: var(--rr-weight-bold);
    line-height: var(--rr-leading-caption);
    color: var(--rr-label2);
  }

  .c-queue.next {
    color: var(--rr-accent);
  }

  .c-queue.dupe {
    font-weight: var(--rr-weight-regular);
  }

  .hl-ink .c-country {
    color: var(--rr-hl-ink);
  }

  .dr.old .c-country {
    color: var(--rr-old-text);
  }

  .dr.old.hl-background .c-country {
    color: var(--rr-hl-old-ink);
  }

  .dr.sel .c-country,
  .dr.old.sel .c-country {
    color: var(--rr-label);
  }
</style>
