<script lang="ts">
  /**
   * The bottom bar. While calling or in a QSO, one status line says what is on air or goes next
   * and when, with the watchdog on the right, and a step bar shows the QSO's progress. Under it,
   * one row of controls: Tx on or off, CQ, Hunt, the ••• menu and Halt. Every control acts on the
   * first tap. Halt is always there and always enabled, and turns solid red while Tx is on or
   * output plays.
   */
  import { tick } from 'svelte';
  import Icon from './Icon.svelte';
  import { signed } from '../lib/clock/format';
  import { bare, parseExchange } from '../lib/qso/messages';
  import { pathBetween } from '../lib/qso/grid';
  import { notReady, type HuntOrder, type QueueOrder } from '../lib/qso/sequencer';
  import { barText, houndText, huntText, runTally, steps, watchdogText } from '../lib/qso/view';
  import { clock } from '../lib/state/now.svelte';
  import { settings, updateSettings } from '../lib/state/settings.svelte';
  import { callCq, endQso, houndOn, qso, runRate, setHound, setHunt, setRun, setStopAfter, setTxEnabled } from '../lib/state/qso.svelte';
  import { halt, startTune, tx } from '../lib/state/station.svelte';
  import { practice } from '../lib/state/practice.svelte';
  import { chooseScenario } from '../lib/practice/runtime.svelte';
  import { SCENARIOS } from '../lib/practice/scenarios';

  let { onmessages, onfindclear }: { onmessages: () => void; onfindclear: () => void } = $props();

  const st = $derived(qso.st);
  const onAir = $derived(qso.onAir);
  const hot = $derived(st.txEnabled || !!onAir || tx.tuning);
  const notice = $derived(qso.notice && clock.ms - qso.notice.atMs < 20_000 ? qso.notice : null);
  const blocked = $derived(st.phase !== 'idle' || st.hunt ? notReady(st) : null);
  const text = $derived(barText(st));
  const hunting = $derived(huntText(st));
  const hounding = $derived(houndText(st));
  /** CQ is on until a station is called by hand or Hunt starts. */
  const cqOn = $derived(st.phase === 'cq' && !st.hunt);
  const running = $derived(cqOn && st.config.run);
  const stepList = $derived(steps(st));
  const tuneLeft = $derived(Math.max(0, Math.ceil((tx.endsAtMs - (clock.ms - Date.now() + performance.now())) / 1000)));
  const aside = $derived.by(() => {
    if (tx.tuning) return `${tuneLeft} s`;
    const wd = watchdogText(st, clock.ms);
    const tally = running ? runTally(runRate(clock.ms)) : null;
    return tally ? `${tally} · ${wd.replace('Watchdog ', '')}` : wd;
  });

  // A selected decode, while idle: who it is and how to call.
  const sel = $derived(qso.selected);
  const selCall = $derived.by(() => {
    if (!sel) return null;
    const ex = parseExchange(sel.decode.text);
    const me = st.config.myCall.toUpperCase();
    if (ex.kind === 'cq') return ex.from;
    if (ex.to && bare(ex.to) === me) return ex.from;
    if (ex.from && bare(ex.from) === me) return ex.to;
    return ex.from ?? ex.to;
  });
  const selLine = $derived.by(() => {
    if (!sel || !selCall) return null;
    const grid = parseExchange(sel.decode.text).grid;
    const p = grid && settings.grid ? pathBetween(settings.grid, grid) : null;
    const where = p ? `${grid} · ${Math.round(p.km).toLocaleString('en-GB')} km` : (grid ?? `${signed(Math.round(sel.decode.snr_db))} dB`);
    return `${bare(selCall)} · ${where}`;
  });

  /** The status line: a pill, the text, the right-hand note, and its tone. Null hides the line. */
  const line = $derived.by((): { pill: { text: string; tone: 'tx' | 'run' } | null; text: string; aside: string; warn: boolean } | null => {
    if (tx.tuning) return { pill: { text: 'Tune', tone: 'tx' }, text: `${settings.txHz} Hz`, aside, warn: false };
    if (onAir) return { pill: { text: 'On air', tone: 'tx' }, text: `Tx${onAir.tx} · ${onAir.text}`, aside, warn: false };
    if (notice) return { pill: null, text: notice.text, aside: st.phase === 'idle' && !st.hunt ? '' : aside, warn: notice.kind !== 'info' };
    if (blocked) return { pill: null, text: blocked, aside, warn: true };
    if (hunting) return { pill: null, text: hunting, aside, warn: false };
    if (hounding && st.partner) return { pill: null, text: hounding, aside, warn: false };
    if (text) return { pill: running ? { text: 'Run', tone: 'run' } : null, text, aside, warn: false };
    if (selLine) return { pill: null, text: selLine, aside: 'Double-tap to call', warn: false };
    if (hounding) return { pill: null, text: hounding, aside, warn: false };
    return null;
  });

  let menuOpen = $state(false);
  let moreBtn: HTMLButtonElement;
  let menuEl: HTMLDivElement | undefined = $state();

  const ORDERS: { id: QueueOrder; label: string }[] = [
    { id: 'first', label: 'First' },
    { id: 'strongest', label: 'Strongest' },
    { id: 'farthest', label: 'Farthest' },
    { id: 'new', label: 'New' },
  ];
  const order = $derived(ORDERS.find((o) => o.id === settings.queueOrder) ?? ORDERS[0]);

  const HUNT_ORDERS: { id: HuntOrder; label: string }[] = [
    { id: 'unworked', label: 'Not worked' },
    { id: 'strongest', label: 'Strongest' },
    { id: 'newest', label: 'Newest' },
    { id: 'farthest', label: 'Farthest' },
    { id: 'new', label: 'New call' },
  ];
  const huntOrder = $derived(HUNT_ORDERS.find((o) => o.id === settings.huntOrder) ?? HUNT_ORDERS[0]);

  async function openMenu() {
    menuOpen = true;
    await tick();
    menuEl?.querySelector<HTMLElement>('[role^=menuitem]')?.focus();
  }

  function closeMenu(focus = true) {
    if (!menuOpen) return;
    menuOpen = false;
    if (focus) moreBtn?.focus();
  }

  /** A menu action: closes the menu, then acts. */
  const act = (fn: () => void) => () => {
    closeMenu(false);
    fn();
  };

  function menuKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeMenu();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...(menuEl?.querySelectorAll<HTMLElement>('[role^=menuitem]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
  }
</script>

<section class="bar" class:hot aria-label="Transmit">
  {#if line}
    <div class="status" role="status">
      {#if line.pill}<span class="pill {line.pill.tone}">{line.pill.text}</span>{/if}
      <span class="msg" class:warn={line.warn} class:mono={!line.warn}>{line.text}</span>
      {#if line.aside}<span class="aside">{line.aside}</span>{/if}
    </div>
  {/if}
  {#if st.partner && !tx.tuning}
    <ol class="steps" aria-label="QSO progress">
      {#each stepList as s, i (i)}
        <li class="step {s.state}"><i></i><span>{s.label}</span></li>
      {/each}
    </ol>
  {/if}
  <div class="ctl">
    <button class="b txb" class:on={st.txEnabled} aria-pressed={st.txEnabled} onclick={() => setTxEnabled(!st.txEnabled)}>
      <span class="dot" aria-hidden="true"></span>{st.txEnabled ? 'Tx on' : 'Tx off'}
    </button>
    <button class="b" class:on={cqOn} aria-pressed={cqOn} onclick={callCq}>CQ</button>
    <button class="b hunt" class:on={st.hunt} aria-pressed={st.hunt} onclick={() => setHunt(!st.hunt)}>Hunt</button>
    <button class="b icon" class:open={menuOpen} bind:this={moreBtn} aria-label="More" aria-haspopup="menu" aria-expanded={menuOpen} onclick={() => (menuOpen ? closeMenu() : void openMenu())}>
      <Icon name="more" size={22} />
    </button>
    <button class="halt" class:solid={hot} onclick={() => halt()}>Halt</button>
  </div>
  {#if menuOpen}
    <div class="scrim" aria-hidden="true" onclick={() => closeMenu(false)}></div>
    <!-- svelte-ignore a11y_interactive_supports_focus -->
    <div class="menu" role="menu" aria-label="More" tabindex="-1" bind:this={menuEl} onkeydown={menuKey}>
      {#if running || st.hunt}
        <button class="mi" role="menuitemcheckbox" aria-checked={st.stopAfter} onclick={() => setStopAfter(!st.stopAfter)}>
          Stop after this QSO{#if st.stopAfter}<Icon name="check" size={18} class="chk" />{/if}
        </button>
      {/if}
      {#if st.phase !== 'idle' || st.partner}
        <button class="mi" role="menuitem" onclick={act(endQso)}>End QSO</button>
      {/if}
      <button class="mi" role="menuitem" onclick={act(onmessages)}>Edit messages</button>
      <button class="mi" role="menuitem" onclick={act(onfindclear)}>Find clear Tx</button>
      <button class="mi gap" role="menuitem" onclick={act(startTune)}>Tune for 10 s</button>
      <button class="mi" role="menuitemcheckbox" aria-checked={settings.run} onclick={() => setRun(!settings.run)}>
        Run <span class="v">{settings.run ? 'On' : 'Off'}</span>
      </button>
      {#if settings.mode === 'FT8'}
        <button class="mi" role="menuitemcheckbox" aria-checked={houndOn()} onclick={() => setHound(!houndOn())}>
          Hound <span class="v">{houndOn() ? 'On' : 'Off'}</span>
        </button>
      {/if}
      <button class="mi" role="menuitem" onclick={() => void updateSettings({ queueOrder: ORDERS[(ORDERS.indexOf(order) + 1) % ORDERS.length].id })}>
        Answer order <span class="v">{order.label}</span>
      </button>
      <button class="mi" role="menuitemcheckbox" aria-checked={settings.workDupes} onclick={() => void updateSettings({ workDupes: !settings.workDupes })}>
        Work dupes <span class="v">{settings.workDupes ? 'On' : 'Off'}</span>
      </button>
      <button class="mi" role="menuitem" onclick={() => void updateSettings({ cqParity: settings.cqParity === 'even' ? 'odd' : 'even' })}>
        Transmit in <span class="v">{settings.cqParity === 'even' ? '1st' : '2nd'}</span>
      </button>
      <button class="mi" class:gap={practice.on} role="menuitem" onclick={() => void updateSettings({ huntOrder: HUNT_ORDERS[(HUNT_ORDERS.indexOf(huntOrder) + 1) % HUNT_ORDERS.length].id })}>
        Hunt order <span class="v">{huntOrder.label}</span>
      </button>
      {#if practice.on}
        {#each SCENARIOS as s (s.id)}
          <button class="mi" role="menuitemradio" aria-checked={practice.scenario === s.id} onclick={act(() => chooseScenario(s.id))}>
            Practice: {s.name}{#if practice.scenario === s.id}<Icon name="check" size={18} class="chk" />{/if}
          </button>
        {/each}
      {/if}
    </div>
  {/if}
</section>

<svelte:window onkeydown={(e) => menuOpen && e.key === 'Escape' && closeMenu()} />

<style>
  .bar {
    position: relative;
    z-index: 3;
    flex: none;
    padding: var(--rr-space-1-5) calc(var(--rr-space-3) + var(--rr-safe-right)) 0 calc(var(--rr-space-3) + var(--rr-safe-left));
    background: var(--rr-dock);
    box-shadow: 0 calc(-1 * var(--rr-hairline)) 0 var(--rr-sep);
  }

  .status {
    display: flex;
    gap: var(--rr-space-2);
    align-items: center;
    height: 22px;
    white-space: nowrap;
  }

  .pill {
    flex: none;
    padding: var(--rr-space-px) var(--rr-space-1-5);
    border-radius: var(--rr-radius-s);
    font-size: var(--rr-text-caption);
    font-weight: var(--rr-weight-bold);
    line-height: var(--rr-leading-caption);
  }

  .pill.tx {
    background: var(--rr-tx-fill);
    color: var(--rr-on-fill);
  }

  .pill.run {
    background: var(--rr-run);
    color: var(--rr-on-strong);
  }

  .msg {
    min-width: 0;
    overflow: hidden;
    font-size: var(--rr-text-row);
    font-weight: var(--rr-weight-semibold);
    text-overflow: ellipsis;
  }

  .msg.warn {
    font-size: var(--rr-text-foot);
    color: var(--rr-warn);
  }

  .aside {
    flex: none;
    margin-left: auto;
    font-size: var(--rr-text-caption);
    color: var(--rr-label2);
    font-variant-numeric: tabular-nums;
  }

  .steps {
    display: flex;
    gap: var(--rr-space-1-5);
    height: 20px;
    margin: 0;
    padding: var(--rr-space-half) 0 0;
    list-style: none;
  }

  .step {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--rr-space-half);
    min-width: 0;
    font-size: var(--rr-text-axis);
    line-height: 12px;
    color: var(--rr-label3);
  }

  .step i {
    height: 3px;
    border-radius: 2px;
    background: var(--rr-fill2);
  }

  .step span {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .step.done i {
    background: var(--rr-accent-fill);
  }

  .step.now {
    font-weight: var(--rr-weight-bold);
    color: var(--rr-tx-text);
  }

  .step.now i {
    background: var(--rr-tx);
  }

  .ctl {
    display: flex;
    gap: var(--rr-space-2);
    align-items: center;
    height: 46px;
    padding-bottom: var(--rr-space-half);
  }

  .b {
    display: flex;
    flex: none;
    gap: var(--rr-space-1-5);
    align-items: center;
    justify-content: center;
    min-width: var(--rr-tap);
    height: var(--rr-tap);
    padding: 0 var(--rr-space-3);
    border-radius: var(--rr-radius-l);
    background: var(--rr-fill-bg);
    color: var(--rr-label);
    font-size: var(--rr-text-callout);
    font-weight: var(--rr-weight-semibold);
    white-space: nowrap;
  }

  .b.icon {
    padding: 0;
  }

  .b.icon.open {
    background: var(--rr-label);
    color: var(--rr-on-strong);
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 4px;
    background: var(--rr-label3);
  }

  .txb.on {
    background: var(--rr-tx-fill);
    color: var(--rr-on-fill);
    font-weight: var(--rr-weight-bold);
  }

  .txb.on .dot {
    background: var(--rr-on-fill);
  }

  .b.on:not(.txb, .hunt) {
    background: var(--rr-accent-fill);
    color: var(--rr-on-fill);
  }

  .hunt.on {
    background: var(--rr-run);
    color: var(--rr-on-strong);
    font-weight: var(--rr-weight-bold);
  }

  .halt {
    flex: 1;
    min-width: var(--rr-tap);
    height: var(--rr-tap);
    border-radius: var(--rr-radius-l);
    background: transparent;
    box-shadow: inset 0 0 0 2px var(--rr-tx);
    color: var(--rr-tx-text);
    font-size: var(--rr-text-body);
    font-weight: var(--rr-weight-bold);
  }

  .halt.solid {
    background: var(--rr-tx-fill);
    box-shadow: none;
    color: var(--rr-on-fill);
  }

  .scrim {
    position: fixed;
    inset: 0;
    z-index: 4;
    background: var(--rr-dim);
    opacity: 0.4;
  }

  .menu {
    position: absolute;
    right: calc(var(--rr-space-3) + var(--rr-safe-right));
    bottom: calc(100% + var(--rr-space-1));
    z-index: 5;
    width: min(268px, calc(100vw - 2 * var(--rr-space-3)));

    /* With the practice scenarios the menu is taller than a small screen: it scrolls. */
    max-height: calc(100dvh - var(--rr-safe-top) - 180px);
    overflow: hidden auto;
    overscroll-behavior: contain;
    border-radius: var(--rr-radius-sheet);
    background: var(--rr-sheet-card);
    box-shadow: 0 12px 40px var(--rr-shadow-thumb);
  }

  .mi {
    display: flex;
    gap: var(--rr-space-2);
    align-items: center;
    justify-content: space-between;
    width: 100%;
    min-height: var(--rr-tap);
    padding: 0 var(--rr-space-4);
    box-shadow: inset 0 calc(-1 * var(--rr-hairline)) 0 var(--rr-sep);
    font-size: var(--rr-text-body);
    text-align: left;
  }

  .mi:last-child {
    box-shadow: none;
  }

  .mi.gap {
    border-bottom: var(--rr-space-2) solid var(--rr-fill);
  }

  .mi:focus-visible {
    outline: 2px solid var(--rr-accent);
    outline-offset: -2px;
  }

  .v {
    font-size: var(--rr-text-sub);
    color: var(--rr-label2);
  }

  .mi :global(.chk) {
    color: var(--rr-accent);
  }
</style>
