<script lang="ts">
  /**
   * A keyboard mode's bottom bar. The status line gives the mark frequency and the tones
   * ("14.0846 MHz · 1585 / 1415 Hz"), or the latest notice for 20 s, and on the right "Rx",
   * "Tx · 3.8 s" on air, "Rx in 2 s" while ending, or "CQ in 3 s" while Repeat CQ waits. With
   * the keyboard up the status line hides. Under it: Tx, Log QSO, ••• and Halt.
   *
   * Tx reads "Tx off" with a grey dot; a tap starts a transmission, "On air" in solid red with a
   * blinking dot. A tap on On air ends it after the queue: "Rx in 2 s" in the accent tint until
   * the queue is sent. A tap while ending keeps it going. Log QSO is at reduced opacity until the
   * strip has a callsign. ••• holds Repeat CQ, the macro set, Tune for 10 s, Save 2 min of audio
   * and Clear text. Halt ends a transmission at once and turns Repeat CQ off.
   */
  import BarButtons, { type BarButton } from './BarButtons.svelte';
  import BarMenu, { type BarMenuItem } from './BarMenu.svelte';
  import { clock } from '../lib/state/now.svelte';
  import { settings } from '../lib/state/settings.svelte';
  import { halt, startTune, tx as station } from '../lib/state/station.svelte';
  import { hasAudio, keyboard, markRfHz, saveAudio, session, stepMacroSet, unmute } from '../lib/state/keyboard.svelte';
  import { spaceHz } from '../lib/rtty/settings';
  import { STATUS } from '../lib/qso/status';

  let { onsaved }: { onsaved?: (r: Awaited<ReturnType<typeof saveAudio>>) => void } = $props();

  const s = session;
  const notice = $derived(s.notice && clock.ms - s.notice.atMs < 20_000 ? s.notice : null);
  const mark = $derived(Math.round(keyboard.markHz));
  const space = $derived(Math.round(spaceHz(settings.rtty, keyboard.markHz)));
  const tuneLeft = $derived(Math.max(0, Math.ceil((station.endsAtMs - (clock.ms - Date.now() + performance.now())) / 1000)));

  const aside = $derived.by(() => {
    if (station.tuning) return `Tune · ${tuneLeft} s`;
    if (s.tx === 'on' || s.tx === 'starting') return `Tx · ${(s.queueS + s.queuedS).toFixed(1)} s`;
    if (s.tx === 'ending') return `Rx in ${Math.max(1, Math.ceil(s.rxInS))} s`;
    if (s.repeat.on && s.repeat.nextAtMs !== null) return `CQ in ${Math.max(0, Math.ceil((s.repeat.nextAtMs - clock.ms) / 1000))} s`;
    return 'Rx';
  });
  const text = $derived(notice ? notice.text : `${(markRfHz() / 1e6).toFixed(4)} MHz · ${mark} / ${space} Hz`);

  let open = $state(false);
  let barEl: HTMLElement;

  function close(focus: boolean) {
    open = false;
    if (focus) barEl?.querySelector<HTMLButtonElement>('[data-id=more]')?.focus();
  }

  function onTx() {
    unmute();
    s.txButton();
  }

  const txButton = $derived.by((): Pick<BarButton, 'label' | 'tone' | 'dot'> => {
    if (s.tx === 'ending') return { label: `Rx in ${Math.max(1, Math.ceil(s.rxInS))} s`, tone: 'soft', dot: 'still' };
    if (s.tx !== 'off' || station.tuning) return { label: 'On air', tone: 'air', dot: 'blink' };
    return { label: 'Tx off', tone: 'plain', dot: 'still' };
  });

  const buttons: BarButton[] = $derived([
    { id: 'tx', ...txButton, pressed: s.tx !== 'off', onclick: onTx },
    { id: 'log', label: 'Log QSO', dim: !s.draft.fields.call, onclick: () => void s.logQso() },
    { id: 'more', label: 'More', icon: 'more', menu: { open }, onclick: () => (open = !open) },
    { id: 'halt', label: 'Halt', tone: 'halt', grow: true, onclick: () => halt() },
  ]);

  const items: BarMenuItem[] = $derived([
    { id: 'repeat', label: 'Repeat CQ', value: s.repeat.on ? 'On' : 'Off', stay: true, onclick: () => (unmute(), s.setRepeat(!s.repeat.on)) },
    { id: 'set', label: 'Macros', value: settings.keyboard.set === 'qso' ? 'QSO' : 'Contest', stay: true, onclick: stepMacroSet },
    { id: 'tune', label: 'Tune for 10 s', gap: true, onclick: () => startTune(mark) },
    { id: 'save', label: 'Save 2 min of audio', onclick: save },
    {
      id: 'clear',
      label: 'Clear text',
      onclick: () => {
        s.clearText();
        s.notice = { text: STATUS.textCleared, atMs: Date.now() };
      },
    },
  ]);

  function save() {
    if (!hasAudio()) return;
    const p = saveAudio();
    if (p) void p.then((r) => onsaved?.(r));
  }
</script>

<section class="bar" aria-label="Transmit" bind:this={barEl}>
  {#if !keyboard.keyboardUp}
    <div class="status" role="status" data-testid="kb-status">
      <span class="msg">{text}</span>
      <span class="aside">{aside}</span>
    </div>
  {/if}
  <BarButtons {buttons} keepFocus />
  {#if open}
    <BarMenu label="More" {items} onclose={close} />
  {/if}
</section>

<style>
  .bar {
    position: relative;
    z-index: 3;
    flex: none;
    padding: 0 calc(var(--rr-space-3) + var(--rr-safe-right)) 0 calc(var(--rr-space-3) + var(--rr-safe-left));
  }

  .status {
    display: flex;
    gap: var(--rr-space-2);
    align-items: center;
    height: 22px;
    padding: 0 var(--rr-space-1);
    white-space: nowrap;
  }

  .msg {
    min-width: 0;
    overflow: hidden;
    font-family: var(--rr-mono);
    font-size: var(--rr-text-row);
    font-weight: var(--rr-weight-semibold);
    text-overflow: ellipsis;
  }

  .aside {
    flex: none;
    margin-left: auto;
    font-size: var(--rr-text-foot);
    color: var(--rr-label2);
    font-variant-numeric: tabular-nums;
  }
</style>
