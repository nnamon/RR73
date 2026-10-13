<script lang="ts" module>
  import type { ListItem } from '../lib/decode/list';

  export type DecodeListItem = ListItem;
</script>

<script lang="ts">
  /**
   * Band activity: 40 px rows marked as in WSJT-X. CQ calls green, messages to you red, what
   * you sent amber, each with a 4 px bar, a tint and the callsign in bold.
   *
   * A tap selects a row, a double-tap calls, and touch and hold opens the station's details.
   */
  import { dt, snr } from '../lib/clock/format';
  import { splitKey, type DecodeRowData } from '../lib/decode/marking';

  type RowItem = Extract<DecodeListItem, { kind: 'row' }>;

  let {
    items,
    label = 'Decodes',
    selectedId = null,
    onselect,
    oncall,
    ondetail,
  }: {
    items: DecodeListItem[];
    label?: string;
    selectedId?: string | null;
    onselect?: (item: RowItem) => void;
    oncall?: (item: RowItem) => void;
    ondetail?: (item: RowItem) => void;
  } = $props();

  const MARK_TEXT = { cq: 'calling CQ', me: 'to you', sent: 'you sent' } as const;
  const HOLD_MS = 500;
  const DOUBLE_MS = 350;

  function spoken(r: DecodeRowData): string {
    const parts = [
      r.time ? `${r.time} UTC` : `${snr(r.decode.snr_db)} dB, DT ${dt(r.decode.dt_s)} s`,
      `${Math.round(r.decode.freq_hz)} Hz`,
      r.decode.text,
      r.mark ? MARK_TEXT[r.mark] : '',
      r.badge?.text ?? '',
      r.meta ?? '',
    ];
    return parts.filter(Boolean).join(', ');
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
    if (lastTap?.id === item.id && now - lastTap.at < DOUBLE_MS) {
      lastTap = null;
      oncall?.(item);
      return;
    }
    lastTap = { id: item.id, at: now };
    onselect?.(item);
  }
</script>

<ul class="list" aria-label={label}>
  {#each items as item (item.id)}
    {#if item.kind === 'header'}
      <li class="slot-head">{item.text}</li>
    {:else}
      {@const r = item.row}
      {@const t = splitKey(r.decode.text, r.key)}
      <li class="dr-item">
        <button
          type="button"
          class="dr"
          class:k-cq={r.mark === 'cq'}
          class:k-me={r.mark === 'me'}
          class:k-sent={r.mark === 'sent'}
          class:worked={r.worked}
          class:sel={selectedId === item.id}
          aria-label={spoken(r)}
          aria-pressed={selectedId === item.id}
          onpointerdown={(e) => down(e, item)}
          onpointermove={move}
          onpointerup={up}
          onpointercancel={up}
          oncontextmenu={(e) => e.preventDefault()}
          onclick={(e) => click(e, item)}
        >
          {#if r.time}
            <span class="c-time" aria-hidden="true">{r.time}</span>
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
        </button>
      </li>
    {/if}
  {/each}
</ul>

<style>
  .list {
    margin: 0;
    padding: 0;
  }

  .slot-head {
    display: flex;
    align-items: center;
    height: 26px;
    padding: var(--rr-space-1) var(--rr-space-4) 0;
    font-size: var(--rr-text-caption);
    line-height: var(--rr-leading-caption);
    letter-spacing: 0;
    color: var(--rr-label3);
  }

  .dr-item {
    position: relative;
  }

  .dr {
    position: relative;
    display: flex;
    align-items: center;
    width: 100%;
    height: var(--rr-row-decode);
    padding: 0 var(--rr-space-4);
    font-size: var(--rr-text-row);
    line-height: var(--rr-leading-row);
    letter-spacing: 0;
    text-align: left;
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
    left: var(--rr-space-4);
    height: var(--rr-hairline);
    background: var(--rr-sep-strong);
    transform: scaleY(0.5);
    transform-origin: 0 0;
  }

  .dr.k-cq {
    background: var(--rr-cq-tint);
  }

  .dr.k-cq::after {
    background: var(--rr-cq);
  }

  .dr.k-me {
    background: var(--rr-me-tint);
  }

  .dr.k-me::after {
    background: var(--rr-tx);
  }

  .dr.k-sent {
    background: var(--rr-sent-tint);
  }

  .dr.k-sent::after {
    background: var(--rr-amber);
  }

  /* After the marking tints, so a selected row shows as selected. */
  .dr.sel {
    background: var(--rr-sel-tint);
    box-shadow: inset 0 0 0 2px var(--rr-accent-fill);
  }

  .c-db,
  .c-dt,
  .c-hz {
    flex: none;
    color: var(--rr-label2);
    text-align: right;
  }

  .c-db {
    width: 28px;
  }

  .c-dt {
    width: 25px;
    margin-left: var(--rr-space-2);
  }

  .c-hz {
    width: 36px;
    margin-left: var(--rr-space-2);
  }

  .c-time {
    flex: none;
    width: 60px;
    font-size: var(--rr-text-foot);
    color: var(--rr-label2);
  }

  .c-msg {
    flex: 1;
    min-width: 0;
    margin-left: var(--rr-space-3);
    overflow: hidden;
    font-family: var(--rr-mono);
    font-size: var(--rr-text-row);
    letter-spacing: 0;
    white-space: pre;
    text-overflow: ellipsis;
  }

  .c-msg b {
    font-weight: var(--rr-weight-bold);
  }

  .worked .c-msg {
    color: var(--rr-label2);
  }

  .c-meta {
    flex: none;
    margin-left: var(--rr-space-2);
    font-size: var(--rr-text-caption);
    line-height: var(--rr-leading-caption);
    letter-spacing: 0;
    color: var(--rr-label2);
  }

  .badge {
    flex: none;
    height: 20px;
    margin-left: var(--rr-space-2);
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
