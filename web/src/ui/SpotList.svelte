<script lang="ts">
  /**
   * WSPR spots under a 22 pt bar per slot (lib/wspr/list.ts). A 32 pt row leads with the callsign
   * in 16 pt semibold and the grid, and ends with distance, reported power, SNR and drift in
   * aligned 12 pt columns ("8558 km 37 dBm −23 dB 0 Hz"). The audio frequency is in the details,
   * and a tap marks the trace on the waterfall. Spots of slots older than the newest
   * slot with spots fade. A spot of the station's own callsign shows in the My call colour.
   *
   * The beacon's transmissions are rows of their own, as in FT8: Next with a countdown, Sending
   * with a red progress line, then Sent.
   *
   * A tap selects a row (or clears the selection, on the selected row) and marks its trace on the
   * waterfall; touch and hold opens the spot's details. Double-tap does nothing in WSPR.
   */
  import { MINUS, signed } from '../lib/clock/format';
  import { TX_OFFSET_S, TX_SECONDS } from '../lib/wspr/schedule';
  import type { WsprItem } from '../lib/wspr/list';
  import type { Spot } from '../lib/wspr/spots';
  import { oldInkFor } from '../lib/decode/highlight-colour';

  let {
    items,
    nowMs,
    selectedId = null,
    /** The My call colour and the Sent colour (Settings › Decode colours), or null when off. */
    myCallColour = null,
    sentColour = null,
    onselect,
    ondetail,
  }: {
    items: WsprItem[];
    nowMs: number;
    selectedId?: string | null;
    myCallColour?: string | null;
    sentColour?: string | null;
    onselect?: (spot: Spot) => void;
    ondetail?: (spot: Spot) => void;
  } = $props();

  const HOLD_MS = 500;

  const km = (s: Spot) => (s.km === null ? '' : `${Math.round(s.km)} km`);
  const db = (s: Spot) => `${signed(Math.round(s.snrDb))} dB`;
  const dbm = (s: Spot) => (s.powerDbm === null ? '' : `${s.powerDbm} dBm`);
  const drift = (s: Spot) => {
    const v = Math.round(s.driftHz);
    return `${v > 0 ? '+' : v < 0 ? MINUS : ''}${Math.abs(v)} Hz`;
  };

  function spoken(s: Spot): string {
    return [s.call ?? 'Unknown callsign', s.grid ?? '', s.km === null ? '' : `${Math.round(s.km)} km`, dbm(s), db(s), `drift ${drift(s)}`].filter(Boolean).join(', ');
  }

  /** "in 0:32" before a Next slot; the time left on air while sending. */
  function txMeta(i: Extract<WsprItem, { kind: 'tx' }>): { text: string; progress: number | null } {
    const start = i.slotStartMs + TX_OFFSET_S * 1000;
    if (i.stage === 'next') {
      const s = Math.max(0, Math.ceil((start - nowMs) / 1000));
      return { text: `in ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`, progress: null };
    }
    if (i.stage === 'sending') return { text: `${i.freqHz} Hz`, progress: Math.min(1, Math.max(0, (nowMs - start) / (TX_SECONDS * 1000))) };
    return { text: i.complete ? `${i.freqHz} Hz` : 'cut short', progress: null };
  }

  const TAG = { next: 'Next', sending: 'Sending', sent: 'Sent' } as const;
  /** Text colours on the faded Sent tint, light and dark, kept at 4.5:1 (highlight-colour.ts). */
  const oldInk = $derived(sentColour ? oldInkFor(sentColour) : null);

  let press: { id: string; x: number; y: number; held: boolean; timer: ReturnType<typeof setTimeout> } | null = null;

  function down(e: PointerEvent, s: Spot) {
    if (press) clearTimeout(press.timer);
    const p = {
      id: s.id,
      x: e.clientX,
      y: e.clientY,
      held: false,
      timer: setTimeout(() => {
        p.held = true;
        ondetail?.(s);
      }, HOLD_MS),
    };
    press = p;
  }

  function move(e: PointerEvent) {
    if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) clearTimeout(press.timer);
  }

  function up() {
    if (press) clearTimeout(press.timer);
  }

  function click(e: MouseEvent, s: Spot) {
    if (press?.id === s.id && press.held) {
      e.preventDefault();
      press = null;
      return;
    }
    press = null;
    onselect?.(s);
  }
</script>

<ul class="list" aria-label="Spots, newest slot first">
  {#each items as item (item.id)}
    {#if item.kind === 'header'}
      <li class="slot-bar {item.tone}">
        <span class="st">{item.time}</span>
        <span class="sd">{item.detail}</span>
      </li>
    {:else if item.kind === 'tx'}
      {@const m = txMeta(item)}
      <li class="sr-item">
        <div class="sr tx {item.stage}" class:old={item.old} class:rr-hl={!!sentColour && item.stage !== 'next'} style:--rr-hl={item.stage !== 'next' ? sentColour : null} style:--rr-ink-light={item.old ? oldInk?.light : null} style:--rr-ink-dark={item.old ? oldInk?.dark : null} data-testid="wspr-{item.stage}">
          <span class="tag">{TAG[item.stage]}</span>
          <span class="msg">{item.text}</span>
          <span class="meta" class:when={item.stage === 'next'}>{m.text}</span>
          {#if m.progress !== null}<i class="prog" style:width="{m.progress * 100}%" aria-hidden="true"></i>{/if}
        </div>
      </li>
    {:else}
      {@const s = item.spot}
      <li class="sr-item">
        <button
          type="button"
          class="sr"
          class:old={item.old}
          class:mine={s.mine && !!myCallColour}
          class:rr-hl={s.mine && !!myCallColour}
          class:sel={selectedId === s.id}
          style:--rr-hl={s.mine ? myCallColour : null}
          aria-label={spoken(s)}
          aria-pressed={selectedId === s.id}
          data-testid="spot-row"
          onpointerdown={(e) => down(e, s)}
          onpointermove={move}
          onpointerup={up}
          onpointercancel={up}
          oncontextmenu={(e) => e.preventDefault()}
          onclick={(e) => click(e, s)}
        >
          <span class="call" aria-hidden="true">{s.call ?? '<...>'}</span>
          <span class="grid" aria-hidden="true">{s.grid ?? ''}</span>
          <span class="n km" aria-hidden="true">{km(s)}</span>
          <span class="n pw" aria-hidden="true">{dbm(s)}</span>
          <span class="n db" aria-hidden="true">{db(s)}</span>
          <span class="n dr" aria-hidden="true">{drift(s)}</span>
        </button>
      </li>
    {/if}
  {/each}
</ul>

<style>
  .list {
    margin: 0;
    padding: 0;
    container-type: inline-size;
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

  .slot-bar .st {
    font-family: var(--rr-mono);
    font-size: var(--rr-text-foot);
    font-weight: var(--rr-weight-bold);
    color: var(--rr-slot-even-strong);
  }

  .slot-bar .sd {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* The slot in progress, and one being decoded: the blue of FT8's odd slots. */
  .slot-bar.live {
    border-top-color: var(--rr-slot-odd-rule);
    background: var(--rr-slot-odd);
    color: var(--rr-slot-odd-text);
  }

  .slot-bar.live .st {
    color: var(--rr-slot-odd-strong);
  }

  .slot-bar.quiet {
    border-top-color: var(--rr-slot-quiet-rule);
    background: var(--rr-slot-quiet);
    color: var(--rr-slot-quiet-text);
  }

  .slot-bar.quiet .st {
    color: var(--rr-slot-quiet-strong);
  }

  .sr-item {
    position: relative;
  }

  .sr {
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
  }

  .sr::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: var(--rr-mark-bar);
  }

  .sr-item + .sr-item .sr::before {
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

  .call {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    font-size: var(--rr-text-decode);
    font-weight: var(--rr-weight-semibold);
    line-height: var(--rr-leading-row);
    color: var(--rr-label);
    text-overflow: ellipsis;
  }

  /* With room for it (393 pt and wider), the grid starts at one x on every row with a callsign of
     up to 7 characters, as in the mockup; at 375 pt it follows the callsign. After .call, so it
     wins over that rule's min-width. */
  @container (width >= 390px) {
    .call {
      min-width: 5.6em;
    }
  }

  .grid {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: var(--rr-text-decode);
    line-height: var(--rr-leading-row);
    color: var(--rr-label2);
  }

  /* Numbers in fixed columns, right-aligned, so they line up from row to row. */
  .n {
    flex: none;
    font-size: var(--rr-text-caption);
    line-height: var(--rr-leading-caption);
    font-variant-numeric: tabular-nums;
    color: var(--rr-label3);
    text-align: right;
  }

  .km {
    min-width: 4.4em;
  }

  .db {
    min-width: 3.3em;
  }

  .dr {
    min-width: 2.7em;
  }

  .pw {
    min-width: 3.9em;
  }

  /* A spot carrying the station's own callsign: the My call colour, as in FT8. */
  .sr.mine {
    background: var(--rr-hl-bg);
  }

  .sr.mine::after {
    background: var(--rr-hl);
  }

  .sr.mine .n,
  .sr.mine .grid {
    color: var(--rr-label);
  }

  .sr.old .call,
  .sr.old .grid,
  .sr.old .n {
    color: var(--rr-old-text);
  }

  .sr.sel,
  .sr.old.sel {
    background: var(--rr-sel-tint);
    box-shadow: inset 0 0 0 2px var(--rr-accent-fill);
  }

  .sr.sel .call,
  .sr.sel .grid,
  .sr.sel .n {
    color: var(--rr-label);
  }

  /* The beacon's transmissions: a tag, the message as sent, and the countdown or frequency. */
  .tx.next {
    background: var(--rr-fill);
  }

  .tx.rr-hl {
    background: var(--rr-hl-bg);
  }

  .tx.rr-hl::after {
    background: var(--rr-hl);
  }

  .tag {
    flex: none;
    font-size: var(--rr-text-tag);
    font-weight: var(--rr-weight-bold);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--rr-label2);
  }

  .tx.rr-hl .tag {
    color: color-mix(in srgb, var(--rr-hl) 35%, var(--rr-label));
  }

  .msg {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    font-size: var(--rr-text-decode);
    font-weight: var(--rr-weight-semibold);
    line-height: var(--rr-leading-row);
    color: var(--rr-label);
    text-overflow: ellipsis;
  }

  .meta {
    flex: none;
    font-size: var(--rr-text-caption);
    line-height: var(--rr-leading-caption);
    font-variant-numeric: tabular-nums;
    color: var(--rr-label3);
  }

  .tx.rr-hl .meta {
    color: var(--rr-label);
  }

  /* A Sent row below newer spots fades as they do: a lighter tint. */
  .tx.old.rr-hl {
    background: var(--rr-hl-bg-old);
  }

  .tx.old.rr-hl::after {
    opacity: 0.6;
  }

  .tx.old.rr-hl .msg,
  .tx.old.rr-hl .meta,
  .tx.old.rr-hl .tag {
    color: var(--rr-hl-old-ink);
  }

  .meta.when {
    font-weight: var(--rr-weight-semibold);
    color: var(--rr-accent);
  }

  .prog {
    position: absolute;
    bottom: 0;
    left: 0;
    height: 3px;
    background: var(--rr-tx);
    transition: width 200ms linear;
  }

  @media (prefers-reduced-motion: reduce) {
    .prog {
      transition: none;
    }
  }
</style>
