<script lang="ts">
  /**
   * A keyboard mode in Operate's frame (views/Operate.svelte; docs/design/rtty.md): the mode's
   * tuning row, the received text with the newest at the bottom, and the dock: the QSO strip, the
   * text to send, the macro row and the bottom bar (KeyboardBar). RTTY is the first keyboard mode;
   * its tuning row is TuningRow. With the keyboard up the tuning row and the status line hide and
   * the dock sits on the keyboard.
   *
   * A tap on a callsign in the text sets the QSO's call and fills the strip from that station's
   * text. A tap on another word opens a menu of the strip's fields it can fill, with the
   * other-case reading first when the word reads differently ("QWU reads 127 in figures"). Touch
   * and hold any word: the same menu with Call added.
   */
  import { onMount } from 'svelte';
  import KeyboardBar from '../../ui/KeyboardBar.svelte';
  import MacroRow from '../../ui/MacroRow.svelte';
  import PopMenu, { type PopMenuItem } from '../../ui/PopMenu.svelte';
  import QsoStrip from '../../ui/QsoStrip.svelte';
  import ReceiveText from '../../ui/ReceiveText.svelte';
  import SendField from '../../ui/SendField.svelte';
  import TuningRow from '../../ui/TuningRow.svelte';
  import type { PaneProps } from './panes';
  import { worked as isWorked, type DraftKey } from '../../lib/keyboard/draft';
  import { callColour } from '../../lib/keyboard/render';
  import { serialText } from '../../lib/keyboard/macros';
  import { bare, fieldOfReading, otherReading, type FillField } from '../../lib/keyboard/words';
  import { buildLogIndex } from '../../lib/log/worked';
  import { log, openDraft } from '../../lib/log/log.svelte';
  import { reference } from '../../lib/reference';
  import { settings } from '../../lib/state/settings.svelte';
  import { currentDialHz, keyboard, session, startKeyboard, unmute } from '../../lib/state/keyboard.svelte';
  import type { SaveResult } from '../../lib/slots/share';

  let { active = true }: PaneProps = $props();

  onMount(() => {
    startKeyboard();
  });

  const s = session;
  const contest = $derived(settings.keyboard.set === 'contest');
  const macros = $derived(settings.keyboard.macros[settings.keyboard.set]);
  const serial = $derived(serialText(settings.keyboard.nextSerial, settings.keyboard.serialDigits));

  let countries = $state.raw(reference.loadedCountries());
  if (!reference.loadedCountries()) void reference.warm({ lotwUsers: false }).then(() => (countries = reference.loadedCountries()));
  const resolves = $derived(countries ? (call: string) => countries!.lookup(call).found : null);

  const logIndex = $derived(buildLogIndex(log.live));
  const colourOf = $derived.by(() => {
    const index = logIndex;
    const me = settings.callsign;
    const band = settings.band;
    const entries = settings.highlights;
    return (call: string) => callColour(call, me, index, band, 'RTTY', entries);
  });
  const worked = $derived(isWorked(log.live, s.draft.fields.call, settings.band, 'RTTY', contest && settings.keyboard.contestId ? settings.keyboard.contestId : null));

  // The word menu.
  let menu = $state<{ word: string; anchor: DOMRect; header: string | null; items: PopMenuItem[]; at: { line: number; at: number } } | null>(null);

  const FIELD_LABEL: Record<FillField, string> = { name: 'Name', qth: 'QTH', rstRcvd: 'RST received', srx: 'Number received', notes: 'Notes' };

  function fillItem(field: FillField, value: string, strong = false): PopMenuItem {
    return {
      id: `${field}-${value}${strong ? '-r' : ''}`,
      label: strong ? `${FIELD_LABEL[field]} ${value}` : FIELD_LABEL[field],
      strong,
      onclick: () => {
        if (field === 'notes') s.editField('notes', [s.draft.fields.notes, value].filter(Boolean).join(' '));
        else s.editField(field as DraftKey, value);
      },
    };
  }

  function onword(word: string, box: DOMRect, how: 'tap' | 'hold', call: string | null, at: { line: number; at: number }) {
    if (how === 'tap' && call) {
      s.setCall(call);
      return;
    }
    const w = bare(word.toUpperCase());
    if (!w) return;
    const reading = otherReading(w, (t) => s.readOtherCase(t));
    const items: PopMenuItem[] = [];
    if (reading) items.push(fillItem(fieldOfReading(reading.text), reading.text, true));
    if (how === 'hold') items.push({ id: 'call', label: 'Call', onclick: () => s.setCall(w) });
    const fields: FillField[] = contest ? ['srx', 'rstRcvd', 'name', 'qth', 'notes'] : ['name', 'qth', 'rstRcvd', 'srx', 'notes'];
    // The reading's field is offered once, with the reading.
    for (const f of fields) if (!reading || f !== fieldOfReading(reading.text)) items.push(fillItem(f, w));
    const header = reading ? `${w} reads ${reading.text} in ${reading.to}` : null;
    menu = { word: w, anchor: box, header, items, at };
  }

  function onsaved(r: SaveResult | null) {
    if (r?.kind !== 'links') return;
    for (const f of [r.links.wav, r.links.json]) {
      const a = document.createElement('a');
      a.href = f.url;
      a.download = f.name;
      a.click();
    }
    setTimeout(() => r.links.revoke(), 10_000);
  }

  function openSheet() {
    const f = s.draft.fields;
    openDraft({
      call: f.call,
      startMs: s.draft.startMs ?? Date.now(),
      band: settings.band,
      mode: 'RTTY',
      freqHz: currentDialHz() + Math.round(keyboard.markHz),
      rstSent: f.rstSent,
      rstRcvd: f.rstRcvd,
      name: f.name,
      qth: f.qth,
      grid: f.grid,
      notes: f.notes,
      stx: contest ? serial : '',
      srx: contest ? f.srx : '',
      contestId: contest ? settings.keyboard.contestId : '',
      onlogged: () => s.loggedFromSheet(),
    });
  }

  // The floating notices (App.svelte) sit above the dock; 0 while Operate is hidden.
  let dockH = $state(0);
  $effect(() => {
    const h = active ? dockH : 0;
    document.documentElement.style.setProperty('--rr-bar-h', `${h}px`);
    return () => document.documentElement.style.removeProperty('--rr-bar-h');
  });
</script>

<div class="kp" data-keyboard-pane>
  {#if !keyboard.keyboardUp}<TuningRow />{/if}
  {#if keyboard.status.state === 'failed'}
    <div class="decoder-error" role="alert">
      <p class="t">No RTTY: the modem did not load</p>
      <p class="s">The waterfall still works. Reload RR73 to try again.</p>
    </div>
  {/if}
  <ReceiveText lines={s.lines} {resolves} {colourOf} {onword} keyboardUp={keyboard.keyboardUp} marked={menu?.at ?? null} />
  <div class="dock" bind:offsetHeight={dockH}>
    <QsoStrip draft={s.draft} {contest} {serial} {worked} onedit={(k, v) => s.editField(k, v)} onsheet={openSheet} />
    <SendField
      value={s.field}
      onAir={s.tx !== 'off'}
      seconds={s.queueS}
      unsendable={s.unsendable}
      ontype={(v) => s.typed(v)}
      onreturn={() => (unmute(), s.returnKey())}
      onclear={() => s.clearField()}
    />
    <MacroRow {macros} ontap={(m) => (unmute(), s.tapMacro(m))} />
    <KeyboardBar {onsaved} />
  </div>
</div>

{#if menu}
  <PopMenu label="Use {menu.word} as" header={menu.header} items={menu.items} anchor={menu.anchor} onclose={() => (menu = null)} />
{/if}

<style>
  .kp {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
  }

  .dock {
    flex: none;
    padding-top: var(--rr-space-1);
    background: var(--rr-dock);
    box-shadow: 0 calc(-1 * var(--rr-hairline)) 0 var(--rr-sep);
  }

  .decoder-error {
    flex: none;
    margin: var(--rr-space-1) var(--rr-space-2);
    padding: var(--rr-space-1-5) var(--rr-space-3);
    border-radius: var(--rr-radius-l);
    background: var(--rr-warn-soft);
  }

  .decoder-error .t {
    font-size: var(--rr-text-foot);
    font-weight: var(--rr-weight-semibold);
    line-height: var(--rr-leading-foot);
    color: var(--rr-warn);
  }

  .decoder-error .s {
    font-size: var(--rr-text-caption);
    line-height: var(--rr-leading-caption);
  }
</style>
