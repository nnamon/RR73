<script lang="ts">
  /**
   * RTTY's tuning row, 36 pt under the waterfall: AFC, the squelch, Rev, and speed and shift, and
   * on the right the signal: 5 bars for −20 to 0 dB SNR with the value, green while the squelch
   * is open and grey while it is closed, with a tick at the squelch level. Each chip is something
   * an operator changes during a QSO when copy goes bad; the rest is in Settings › RTTY.
   */
  import Icon from './Icon.svelte';
  import PopMenu, { type PopMenuItem } from './PopMenu.svelte';
  import { go } from '../lib/app/router.svelte';
  import { MINUS } from '../lib/clock/format';
  import { PRESETS, SQUELCH_MENU, presetLabel } from '../lib/rtty/settings';
  import { settings } from '../lib/state/settings.svelte';
  import { session, setAfc, setPreset, setReverse, setSquelch } from '../lib/state/keyboard.svelte';

  const r = $derived(settings.rtty);
  const sqText = (db: number | null) => (db === null ? 'Off' : `${db < 0 ? MINUS : ''}${Math.abs(db)}`);

  let open = $state<{ which: 'sq' | 'preset'; anchor: DOMRect } | null>(null);

  function toggle(which: 'sq' | 'preset', e: MouseEvent) {
    const el = (e.currentTarget as HTMLElement).querySelector('.pill') ?? (e.currentTarget as HTMLElement);
    open = open?.which === which ? null : { which, anchor: el.getBoundingClientRect() };
  }

  function close(focus: boolean) {
    const was = open?.which;
    open = null;
    if (focus && was) document.querySelector<HTMLButtonElement>(`[data-chip=${was}]`)?.focus();
  }

  const sqItems: PopMenuItem[] = $derived(SQUELCH_MENU.map((db) => ({ id: `sq${db}`, label: db === null ? 'Off' : `${sqText(db)} dB`, checked: db === r.squelchDb, onclick: () => setSquelch(db) })));
  const presetItems: PopMenuItem[] = $derived([
    ...PRESETS.map((p) => ({ id: `p${p.baud}-${p.shiftHz}`, label: presetLabel(p.baud, p.shiftHz), checked: p.baud === r.baud && p.shiftHz === r.shiftHz, onclick: () => setPreset(p.baud, p.shiftHz) })),
    { id: 'other', label: 'Other', onclick: () => go('settings', 'rtty') },
  ]);

  // The signal: −20 dB lights no bar, 0 dB all 5. The squelch tick sits at its level on the same scale.
  const snr = $derived(session.signal?.snrDb ?? null);
  const lit = $derived(snr === null ? 0 : Math.max(0, Math.min(5, Math.ceil((snr + 20) / 4))));
  const shut = $derived(session.signal ? !session.signal.squelchOpen : false);
  const tick = $derived(r.squelchDb === null ? null : Math.max(0, Math.min(1, (r.squelchDb + 20) / 20)));
  const snrText = $derived(snr === null ? '' : `${snr < -0.5 ? MINUS : ''}${Math.abs(Math.round(snr))} dB`);
</script>

<div class="tr" role="toolbar" aria-label="Tuning">
  <button class="chip" class:on={r.afc} aria-pressed={r.afc} onclick={() => setAfc(!r.afc)}><span class="pill">AFC</span></button>
  <button class="chip" class:open={open?.which === 'sq'} data-chip="sq" aria-haspopup="menu" aria-expanded={open?.which === 'sq'} aria-label="Squelch {sqText(r.squelchDb)}{r.squelchDb === null ? '' : ' dB'}" onclick={(e) => toggle('sq', e)}>
    <span class="pill">Sq {sqText(r.squelchDb)}</span>
  </button>
  <button class="chip" class:on={r.reverse} aria-pressed={r.reverse} aria-label="Reverse" onclick={() => setReverse(!r.reverse)}><span class="pill">Rev</span></button>
  <button class="chip" class:open={open?.which === 'preset'} data-chip="preset" aria-haspopup="menu" aria-expanded={open?.which === 'preset'} aria-label="Speed and shift {r.baud} baud, {r.shiftHz} Hz" onclick={(e) => toggle('preset', e)}>
    <span class="pill">{presetLabel(r.baud, r.shiftHz)}<Icon name="chevdown" size={11} class="dn" /></span>
  </button>
  <span class="meter" role="meter" aria-label="Signal" aria-valuemin={-20} aria-valuemax={0} aria-valuenow={snr === null ? undefined : Math.round(snr)} aria-valuetext={snrText || 'No signal'}>
    <span class="bars" aria-hidden="true">
      {#each [0, 1, 2, 3, 4] as i (i)}
        <i class:on={i < lit && !shut} class:shut={i < lit && shut} style:height="{6 + i * 3}px"></i>
      {/each}
      {#if tick !== null}<b class="sq" style:left="{tick * 100}%"></b>{/if}
    </span>
    <span class="v">{snrText}</span>
  </span>
</div>

{#if open?.which === 'sq'}
  <PopMenu label="Squelch" items={sqItems} anchor={open.anchor} onclose={close} />
{:else if open?.which === 'preset'}
  <PopMenu label="Speed and shift" items={presetItems} anchor={open.anchor} onclose={close} />
{/if}

<style>
  .tr {
    position: relative;
    z-index: 1;
    display: flex;
    flex: none;
    align-items: center;
    height: var(--rr-filters);
    padding: 0 calc(var(--rr-space-3) + var(--rr-safe-right)) 0 calc(var(--rr-space-3) + var(--rr-safe-left));
    background: var(--rr-plain);
    box-shadow: inset 0 calc(-1 * var(--rr-hairline)) 0 var(--rr-sep);
  }

  /* 28 pt chips inside 44 pt targets that reach over the edges of the 36 pt row, as in FT8's filters. */
  .chip {
    display: flex;
    flex: none;
    align-items: center;
    min-width: var(--rr-tap);
    height: var(--rr-tap);
    margin: calc((var(--rr-filters) - var(--rr-tap)) / 2) 0;
    padding: 0 var(--rr-space-half);
  }

  .pill {
    display: flex;
    gap: var(--rr-space-1);
    align-items: center;
    height: var(--rr-chip);
    padding: 0 var(--rr-space-2);
    border-radius: var(--rr-radius-pill);
    background: var(--rr-fill-bg);
    font-size: var(--rr-text-row);
    font-weight: var(--rr-weight-semibold);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .chip.on .pill {
    background: var(--rr-accent-fill);
    color: var(--rr-on-fill);
  }

  .chip.open .pill {
    box-shadow: 0 0 0 2px var(--rr-accent);
  }

  .pill :global(.dn) {
    color: var(--rr-label2);
  }

  .chip:focus-visible {
    outline: none;
  }

  .chip:focus-visible .pill {
    outline: 2px solid var(--rr-accent);
    outline-offset: 1px;
  }

  .meter {
    display: flex;
    flex: none;
    gap: var(--rr-space-1-5);
    align-items: center;
    margin-left: auto;
    padding-left: var(--rr-space-1);
    font-size: var(--rr-text-foot);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    color: var(--rr-label2);
  }

  .bars {
    position: relative;
    display: flex;
    gap: var(--rr-space-half);
    align-items: flex-end;
    height: 18px;
  }

  .bars i {
    width: 4px;
    border-radius: 1px;
    background: var(--rr-fill);
  }

  .bars i.on {
    background: var(--rr-ok-bar);
  }

  .bars i.shut {
    background: var(--rr-chev);
  }

  .bars .sq {
    position: absolute;
    top: calc(-1 * var(--rr-space-half));
    bottom: calc(-1 * var(--rr-space-half));
    width: 1px;
    background: var(--rr-label);
  }

  .v {
    min-width: 3.4em;
    text-align: right;
  }

  /* At 375 pt the row keeps the chips and the bars whole; the value gives up its spare width. */
  @media (width < 390px) {
    .tr {
      padding-right: calc(var(--rr-space-2) + var(--rr-safe-right));
      padding-left: calc(var(--rr-space-2) + var(--rr-safe-left));
    }

    .v {
      min-width: 0;
    }
  }
</style>
