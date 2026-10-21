<script lang="ts">
  /**
   * The bottom bar, one height in every state. A status line says what is on air or goes next and
   * when, with the watchdog on the right; while calling CQ, answering or in a QSO a step row shows
   * the progress (CQ has its own steps), and its space stays reserved otherwise. Under them, one
   * row of buttons from data (BarButtons): Tx, CQ, Hunt, the ••• menu and Halt. The Tx button
   * carries the state: Tx off in grey, Tx on in a light accent tint, and On air in solid red with a
   * blinking dot; solid fills mean an active CQ (blue), Hunt (green) or a transmission (red). Every
   * button acts on the first tap. Halt is always there, always enabled, a red outline.
   *
   * Larger windows (lib/app/layout.svelte.ts) place the same parts differently. `panel`, regular
   * width: a 336 pt column on the right with the status, the steps, Tx1 to Tx6 (a click sends one
   * next; Edit opens the messages sheet, which leaves •••), the buttons at their own widths and
   * Halt, 304 x 64 pt, the largest control. `bottom`, regular width taller than wide: a bar along
   * the bottom with Halt 240 x 64 pt on the right. `side`, a phone on its side: the column under
   * the waterfall, with Halt across it.
   */
  import { tick } from 'svelte';
  import BarButtons, { type BarButton } from './BarButtons.svelte';
  import Icon from './Icon.svelte';
  import { signed } from '../lib/clock/format';
  import { bare, parseExchange } from '../lib/qso/messages';
  import { gridPath } from '../lib/reference/grid';
  import { notReady, type HuntOrder, type QueueOrder } from '../lib/qso/sequencer';
  import { barText, houndText, huntText, runTally, watchdogText } from '../lib/qso/view';
  import { TX_NUMS } from '../lib/qso/messages';
  import { messages } from '../lib/qso/sequencer';
  import { layout } from '../lib/app/layout.svelte';
  import { active, barSteps, txButton } from '../lib/operate/bar';
  import { clock } from '../lib/state/now.svelte';
  import { settings, updateSettings } from '../lib/state/settings.svelte';
  import { callCq, chooseNext, endQso, houndOn, qso, runRate, setHound, setHunt, setRun, setStopAfter, setTxEnabled } from '../lib/state/qso.svelte';
  import { halt, startTune, tx } from '../lib/state/station.svelte';
  import { practice } from '../lib/state/practice.svelte';
  import { chooseScenario } from '../lib/practice/runtime.svelte';
  import { SCENARIOS } from '../lib/practice/scenarios';
  import { showNight } from '../lib/state/night.svelte';

  type Variant = 'phone' | 'panel' | 'bottom' | 'side';
  let {
    onmessages,
    onfindclear,
    onclear,
    variant = 'phone',
  }: { onmessages: () => void; onfindclear: () => void; onclear: () => void; variant?: Variant } = $props();

  /** The panel lists Tx1 to Tx6; elsewhere they are in the messages sheet, from •••. */
  const listed = $derived(variant === 'panel');
  const all = $derived(listed ? messages(qso.st) : null);

  const st = $derived(qso.st);
  const onAir = $derived(qso.onAir);
  const notice = $derived(qso.notice && clock.ms - qso.notice.atMs < 20_000 ? qso.notice : null);
  const blocked = $derived(st.phase !== 'idle' || st.hunt ? notReady(st) : null);
  const text = $derived(barText(st));
  const hunting = $derived(huntText(st));
  const hounding = $derived(houndText(st));
  /** CQ is on until a station is called by hand or Hunt starts. */
  const cqOn = $derived(st.phase === 'cq' && !st.hunt);
  const running = $derived(cqOn && st.config.run);
  const stepList = $derived(active(st) && !tx.tuning ? barSteps(st) : []);
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
    const p = grid && settings.grid ? gridPath(settings.grid, grid) : null;
    const where = p ? `${grid} · ${Math.round(p.km).toLocaleString('en-GB')} km` : (grid ?? `${signed(Math.round(sel.decode.snr_db))} dB`);
    return `${bare(selCall)} · ${where}`;
  });

  /** The status line: the text and the right-hand note, in one style whatever they say. Null leaves the line empty. */
  const line = $derived.by((): { text: string; aside: string } | null => {
    if (tx.tuning) return { text: `Tune · ${settings.txHz} Hz`, aside };
    if (onAir) return { text: `Tx${onAir.tx} · ${onAir.text}`, aside };
    if (notice) return { text: notice.text, aside: st.phase === 'idle' && !st.hunt ? '' : aside };
    if (blocked) return { text: blocked, aside };
    if (hunting) return { text: hunting, aside };
    if (hounding && st.partner) return { text: hounding, aside };
    if (text) return { text, aside };
    if (selLine) return { text: selLine, aside: layout.pointer === 'mouse' ? 'Double-click to call' : 'Double-tap to call' };
    if (hounding) return { text: hounding, aside };
    return null;
  });

  // The floating notices (App.svelte) sit above this bar; 0 while Operate is hidden, and beside
  // a panel or a column, which leave the bottom edge to the list.
  let barH = $state(0);
  $effect(() => {
    document.documentElement.style.setProperty('--rr-bar-h', `${variant === 'phone' || variant === 'bottom' ? barH : 0}px`);
    return () => document.documentElement.style.removeProperty('--rr-bar-h');
  });

  let menuOpen = $state(false);
  let barEl: HTMLElement;
  let menuEl: HTMLDivElement | undefined = $state();
  let dockEl: HTMLDivElement | undefined = $state();
  /** Larger windows: where the menu sits, fixed to the window so the panel's edges cannot clip it. */
  let menuAt = $state<{ bottom: number; right: number } | null>(null);

  const ORDERS: { id: QueueOrder; label: string }[] = [
    { id: 'first', label: 'First' },
    { id: 'strongest', label: 'Strongest' },
    { id: 'weakest', label: 'Weakest' },
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
    const r = variant !== 'phone' ? dockEl?.getBoundingClientRect() : undefined;
    menuAt = r ? { bottom: window.innerHeight - r.top, right: window.innerWidth - r.right } : null;
    menuOpen = true;
    await tick();
    menuEl?.querySelector<HTMLElement>('[role^=menuitem]')?.focus();
  }

  function closeMenu(focus = true) {
    if (!menuOpen) return;
    menuOpen = false;
    if (focus) barEl?.querySelector<HTMLButtonElement>('[data-id=more]')?.focus();
  }

  /** A menu action: closes the menu, then acts. */
  const act = (fn: () => void) => () => {
    closeMenu(false);
    fn();
  };

  const txb = $derived(txButton(st.txEnabled, !!onAir || tx.tuning));
  const buttons: BarButton[] = $derived([
    { id: 'tx', label: txb.label, tone: txb.look === 'off' ? 'plain' : txb.look === 'on' ? 'soft' : 'air', pressed: st.txEnabled, dot: txb.look === 'air' ? 'blink' : 'still', onclick: () => setTxEnabled(!st.txEnabled) },
    { id: 'cq', label: 'CQ', tone: cqOn ? 'selected' : 'plain', pressed: cqOn, onclick: callCq },
    { id: 'hunt', label: 'Hunt', tone: st.hunt ? 'run' : 'plain', pressed: st.hunt, onclick: () => setHunt(!st.hunt) },
    { id: 'more', label: 'More', icon: 'more', menu: { open: menuOpen }, onclick: () => (menuOpen ? closeMenu() : void openMenu()) },
    { id: 'halt', label: 'Halt', tone: 'halt', grow: true, kbd: variant === 'panel' && layout.pointer === 'mouse' ? 'esc' : undefined, onclick: () => halt() },
  ]);

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

<section class="bar {variant}" aria-label="Transmit" bind:this={barEl} bind:offsetHeight={barH}>
  {#if variant === 'panel'}<h2 class="head">Transmit</h2>{/if}
  <div class="status" role="status">
    {#if line}
      <span class="msg">{line.text}</span>
      {#if line.aside}<span class="aside">{line.aside}</span>{/if}
    {/if}
  </div>
  {#if stepList.length}
    <ol class="steps" aria-label="QSO progress">
      {#each stepList as s, i (i)}
        <li class="step {s.state}"><i></i><span>{s.label}</span></li>
      {/each}
    </ol>
  {:else}
    <div class="steps" aria-hidden="true"></div>
  {/if}
  {#if all}
    <div class="head">
      <h2 id="tx-messages">Messages</h2>
      <button class="edit" onclick={onmessages}>Edit messages</button>
    </div>
    <div class="msgs" role="radiogroup" aria-labelledby="tx-messages">
      {#each TX_NUMS as n (n)}
        <button
          class="m"
          class:cur={st.current === n && (st.txEnabled || !!onAir)}
          role="radio"
          aria-checked={st.current === n}
          aria-label="Tx{n}: {all[n] || 'needs a station'}"
          disabled={!all[n]}
          onclick={() => chooseNext(n)}
        >
          <small aria-hidden="true">Tx{n}</small>
          {#if all[n]}<span class="t" aria-hidden="true">{all[n]}</span>{:else}<span class="ph" aria-hidden="true">Needs a station</span>{/if}
        </button>
      {/each}
    </div>
    <span class="grow"></span>
  {/if}
  <div class="dock" bind:this={dockEl}>
  <BarButtons {buttons} {variant} />
  {#if menuOpen}
    <div class="scrim" aria-hidden="true" onclick={() => closeMenu(false)}></div>
    <!-- svelte-ignore a11y_interactive_supports_focus -->
    <div
      class="menu"
      class:fixed={menuAt !== null}
      style:bottom={menuAt ? `calc(${menuAt.bottom}px + var(--rr-space-1))` : null}
      style:right={menuAt ? `${menuAt.right}px` : null}
      role="menu"
      aria-label="More"
      tabindex="-1"
      bind:this={menuEl}
      onkeydown={menuKey}
    >
      {#if running || st.hunt}
        <button class="mi" role="menuitemcheckbox" aria-checked={st.stopAfter} onclick={() => setStopAfter(!st.stopAfter)}>
          Stop after this QSO{#if st.stopAfter}<Icon name="check" size={18} class="chk" />{/if}
        </button>
      {/if}
      {#if st.phase !== 'idle' || st.partner}
        <button class="mi" role="menuitem" onclick={act(endQso)}>End QSO</button>
      {/if}
      {#if !listed}<button class="mi" role="menuitem" onclick={act(onmessages)}>Edit messages</button>{/if}
      <button class="mi" role="menuitem" onclick={act(onfindclear)}>Find clear Tx</button>
      <button class="mi" role="menuitem" onclick={act(startTune)}>Tune for 10 s</button>
      <button class="mi" role="menuitem" onclick={act(showNight)}>Night display</button>
      <button class="mi gap" role="menuitem" onclick={act(onclear)}>Clear decodes</button>
      <button class="mi" role="menuitemcheckbox" aria-checked={settings.run} onclick={() => setRun(!settings.run)}>
        Repeat CQ <span class="v">{settings.run ? 'On' : 'Off'}</span>
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
        Transmit in <span class="v">{settings.cqParity === 'even' ? '1st (Even)' : '2nd (Odd)'}</span>
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
  </div>
</section>

<svelte:window onkeydown={(e) => menuOpen && e.key === 'Escape' && closeMenu()} />

<style>
  .bar {
    position: relative;
    z-index: 3;
    flex: none;
    padding: var(--rr-space-1) calc(var(--rr-space-3) + var(--rr-safe-right)) 0 calc(var(--rr-space-3) + var(--rr-safe-left));
    background: var(--rr-dock);
    box-shadow: 0 calc(-1 * var(--rr-hairline)) 0 var(--rr-sep);
  }

  .status {
    display: flex;
    gap: var(--rr-space-2);
    align-items: center;
    height: 20px;
    white-space: nowrap;
  }

  .msg {
    min-width: 0;
    overflow: hidden;
    font-size: var(--rr-text-row);
    font-weight: var(--rr-weight-semibold);
    text-overflow: ellipsis;
  }

  .aside {
    flex: none;
    margin-left: auto;
    font-size: var(--rr-text-caption);
    color: var(--rr-label2);
    font-variant-numeric: tabular-nums;
  }

  /* Always 18 pt, empty while idle, so the bar keeps its height. */
  .steps {
    display: flex;
    gap: var(--rr-space-1-5);
    height: 18px;
    margin: 0;
    padding: var(--rr-space-px) 0 0;
    list-style: none;
  }

  /* Caption 2 at its 13 pt leading, so descenders show: 1 + 3 + 1 + 13 pt fill the 18 pt row. */
  .step {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--rr-space-px);
    min-width: 0;
    font-size: var(--rr-text-axis);
    line-height: var(--rr-leading-tag);
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

  /* The phone: the buttons and the menu belong to the bar itself. */
  .dock {
    display: contents;
  }

  /* Larger windows: the menu opens over the buttons. */
  .panel .dock,
  .bottom .dock,
  .side .dock {
    position: relative;
    display: block;
  }

  .panel .menu,
  .bottom .menu,
  .side .menu {
    right: 0;
  }

  /* Fixed to the window above the buttons, so it opens over the waterfall unclipped. */
  .menu.fixed {
    position: fixed;
  }

  .panel .status,
  .bottom .status,
  .side .status {
    height: auto;
    min-height: var(--rr-leading-row);
  }

  .panel .msg,
  .bottom .msg,
  .side .msg {
    font-family: var(--rr-mono);
    font-weight: var(--rr-weight-medium);
    line-height: var(--rr-leading-row);
    letter-spacing: 0;
  }

  .panel .aside,
  .bottom .aside {
    font-size: var(--rr-text-foot);
  }

  .panel .steps,
  .bottom .steps,
  .side .steps {
    gap: var(--rr-space-1-5);
    height: auto;
    min-height: var(--rr-steps-tall);
  }

  .panel .step,
  .bottom .step,
  .side .step {
    gap: var(--rr-space-1);
    font-size: var(--rr-text-foot);
    line-height: var(--rr-leading-foot);
  }

  .panel .step i,
  .bottom .step i,
  .side .step i {
    height: var(--rr-mark-bar);
  }

  .panel .step.done,
  .bottom .step.done,
  .side .step.done {
    color: var(--rr-label2);
  }

  /* Regular width: the transmit panel on the right, Halt at its foot. */
  .panel {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--rr-space-3);
    min-height: 0;
    overflow: hidden;
    padding: var(--rr-space-3) calc(var(--rr-space-4) + var(--rr-safe-right)) calc(var(--rr-space-4) + var(--rr-safe-bottom)) var(--rr-space-4);
    background: var(--rr-bg);
    box-shadow: inset var(--rr-hairline) 0 0 var(--rr-sep-strong);
  }

  .panel .status {
    flex-direction: column;
    gap: var(--rr-space-1);
    align-items: flex-start;
  }

  .panel .msg {
    max-width: 100%;
  }

  .panel .aside {
    margin-left: 0;
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: var(--rr-leading-foot);
    font-size: var(--rr-text-foot);
    font-weight: var(--rr-weight-semibold);
    line-height: var(--rr-leading-foot);
    color: var(--rr-label2);
  }

  .head h2 {
    font: inherit;
  }

  /* A text button, 44 pt high, that reaches over the header's line. */
  .edit {
    min-height: var(--rr-tap);
    margin: calc((var(--rr-leading-foot) - var(--rr-tap)) / 2) calc(-1 * var(--rr-space-2));
    padding: 0 var(--rr-space-2);
    color: var(--rr-accent);
    font-size: var(--rr-text-sub);
    font-weight: var(--rr-weight-regular);
  }

  /* In a short window the messages scroll, so the buttons and Halt stay whole. */
  .msgs {
    flex: 0 1 auto;
    min-height: 0;
    overflow: hidden auto;
    border-radius: var(--rr-radius-l);
    background: var(--rr-surface);
  }

  .m {
    display: flex;
    gap: var(--rr-space-3);
    align-items: center;
    width: 100%;
    height: var(--rr-message-row);
    padding: 0 var(--rr-space-3);
    box-shadow: inset 0 calc(-1 * var(--rr-hairline)) 0 var(--rr-sep);
    font-family: var(--rr-mono);
    font-size: var(--rr-text-row);
    font-weight: var(--rr-weight-medium);
    letter-spacing: 0;
    text-align: left;
    white-space: nowrap;
  }

  .m:last-child {
    box-shadow: none;
  }

  .m small {
    flex: none;
    width: var(--rr-kbd);
    font-family: var(--rr-sans);
    font-size: var(--rr-text-caption);
    font-weight: var(--rr-weight-semibold);
    color: var(--rr-label2);
  }

  .m .t {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .m .ph {
    font-family: var(--rr-sans);
    font-weight: var(--rr-weight-regular);
    color: var(--rr-label3);
  }

  .m[aria-checked='true'] small {
    color: var(--rr-accent);
  }

  .m.cur {
    background: var(--rr-tx-soft);
    color: var(--rr-tx-text);
  }

  .m.cur small {
    color: var(--rr-tx-text);
  }

  .m:focus-visible {
    outline: 2px solid var(--rr-accent);
    outline-offset: -2px;
  }

  @media (hover: hover) {
    .m:not(:disabled, .cur):hover {
      background: var(--rr-fill3);
    }
  }

  .grow {
    flex: 1;
  }

  /* Regular width, taller than wide: a bar along the bottom. */
  .bottom {
    display: flex;
    flex-direction: column;
    gap: var(--rr-space-2);
    padding: var(--rr-space-2) calc(var(--rr-space-4) + var(--rr-safe-right)) calc(var(--rr-space-3) + var(--rr-safe-bottom)) calc(var(--rr-space-4) + var(--rr-safe-left));
  }

  .bottom .steps {
    max-width: var(--rr-steps-wide);
  }

  /* A phone on its side: the column under the waterfall. */
  .side {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--rr-space-2);
    justify-content: flex-end;
    padding: var(--rr-space-2) calc(var(--rr-space-3) + var(--rr-safe-right)) calc(var(--rr-space-2) + var(--rr-safe-bottom)) var(--rr-space-3);
    box-shadow: inset var(--rr-hairline) 0 0 var(--rr-sep-strong);
  }
</style>
