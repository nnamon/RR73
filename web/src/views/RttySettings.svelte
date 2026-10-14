<script lang="ts">
  /**
   * Settings › RTTY (docs/design/rtty.md, "Settings"): the signal, receive and transmit settings,
   * the macros and the contest. AFC, the squelch, Rev, and speed and shift are also in Operate's
   * tuning row.
   */
  import BackLink from '../ui/BackLink.svelte';
  import Icon from '../ui/Icon.svelte';
  import { href } from '../lib/app/router.svelte';
  import { MINUS } from '../lib/clock/format';
  import { BAUDS, IDLE_STOPS_S, SHIFTS, STOP_BITS, secondsText, type RttySettings } from '../lib/rtty/settings';
  import { normaliseContestId, type KeyboardSettings } from '../lib/keyboard/settings';
  import { serialText } from '../lib/keyboard/macros';
  import { settings, updateSettings } from '../lib/state/settings.svelte';
  import { setReverse, setRtty } from '../lib/state/keyboard.svelte';

  const r = $derived(settings.rtty);
  const k = $derived(settings.keyboard);

  function save(patch: Partial<RttySettings>) {
    setRtty(patch);
  }

  function saveKb(patch: Partial<KeyboardSettings>) {
    void updateSettings({ keyboard: { ...settings.keyboard, ...patch } });
  }

  const OTHER = -1;
  const db = (v: number) => `${v < 0 ? MINUS : ''}${Math.abs(v)} dB`;

  /** A select with listed values and Other, which shows a field for any value in range. */
  function choice(list: readonly number[], v: number, other: boolean): number {
    return other || !list.includes(v) ? OTHER : v;
  }

  let baudOther = $state(!(BAUDS as readonly number[]).includes(settings.rtty.baud));
  let shiftOther = $state(!(SHIFTS as readonly number[]).includes(settings.rtty.shiftHz));
  let idleOther = $state(!IDLE_STOPS_S.includes(settings.rtty.idleStopS));
  const WATCHDOGS = [5, 10, 15, 30, 60, 0];
  let dogOther = $state(!WATCHDOGS.includes(settings.rtty.watchdogMin));
  const GAPS = [1, 2, 3, 4, 5, 6, 8, 10, 15, 20, 30, 45, 60];
  const PREAMBLES = [0, 0.5, 1, 1.5, 2, 3, 4, 5];
  const SQUELCHES = Array.from({ length: 31 }, (_, i) => -30 + i);

  // Fields for Other: the text as typed, put back to the stored value when it cannot be used.
  let baudText = $state(String(settings.rtty.baud));
  let shiftText = $state(String(settings.rtty.shiftHz));
  let idleText = $state(String(settings.rtty.idleStopS));
  let dogText = $state(String(settings.rtty.watchdogMin));
  let contestText = $state(settings.keyboard.contestId);
  let serialTextField = $state(serialText(settings.keyboard.nextSerial, settings.keyboard.serialDigits));
  let exchangeText = $state(settings.keyboard.exchange);
  $effect(() => {
    baudText = String(settings.rtty.baud);
    shiftText = String(settings.rtty.shiftHz);
    idleText = String(settings.rtty.idleStopS);
    dogText = String(settings.rtty.watchdogMin);
  });
  $effect(() => {
    contestText = settings.keyboard.contestId;
    serialTextField = serialText(settings.keyboard.nextSerial, settings.keyboard.serialDigits);
    exchangeText = settings.keyboard.exchange;
  });

  function num(text: string, lo: number, hi: number): number | null {
    const v = Number(text.trim().replace(',', '.'));
    return text.trim() && Number.isFinite(v) && v >= lo && v <= hi ? v : null;
  }

  function saveBaud() {
    const v = num(baudText, 20, 150);
    if (v === null) baudText = String(settings.rtty.baud);
    else save({ baud: Math.round(v * 100) / 100 });
  }

  function saveShift() {
    const v = num(shiftText, 50, 1000);
    if (v === null) shiftText = String(settings.rtty.shiftHz);
    else save({ shiftHz: Math.round(v) });
  }

  function saveIdle() {
    const v = num(idleText, 0, 86_400);
    if (v === null || (v > 0 && v < 10)) idleText = String(settings.rtty.idleStopS);
    else save({ idleStopS: Math.round(v) });
  }

  function saveDog() {
    const v = num(dogText, 0, 9999);
    if (v === null) dogText = String(settings.rtty.watchdogMin);
    else save({ watchdogMin: Math.round(v * 10) / 10 });
  }

  function saveSerial() {
    const v = num(serialTextField, 1, 9999);
    if (v === null || !Number.isInteger(v)) serialTextField = serialText(settings.keyboard.nextSerial, settings.keyboard.serialDigits);
    else saveKb({ nextSerial: v });
  }

  const macroCount = $derived(k.macros[k.set].length);
  const blur = (e: KeyboardEvent) => e.key === 'Enter' && (e.currentTarget as HTMLElement).blur();
</script>

<section class="screen sub" aria-labelledby="rtty-title">
  <BackLink to={href('settings')} label="Settings" title="RTTY" id="rtty-title" />

  <div class="section">
    <h2 class="section-head">Signal</h2>
    <div class="group">
      <label class="row">
        <span class="row-title">Speed</span>
        <select
          class="select"
          value={choice(BAUDS, r.baud, baudOther)}
          onchange={(e) => {
            const v = Number(e.currentTarget.value);
            baudOther = v === OTHER;
            if (!baudOther) save({ baud: v });
          }}
        >
          {#each BAUDS as b (b)}<option value={b}>{b} baud</option>{/each}
          <option value={OTHER}>Other</option>
        </select>
        <Icon name="updown" size={13} class="row-chevron" />
      </label>
      {#if baudOther || !(BAUDS as readonly number[]).includes(r.baud)}
        <label class="row">
          <span class="row-title">Baud</span>
          <input class="field num" type="text" inputmode="decimal" bind:value={baudText} onblur={saveBaud} onkeydown={blur} autocomplete="off" aria-label="Speed, 20 to 150 baud" />
          <span class="unit">baud</span>
        </label>
      {/if}
      <label class="row">
        <span class="row-title">Shift</span>
        <select
          class="select"
          value={choice(SHIFTS, r.shiftHz, shiftOther)}
          onchange={(e) => {
            const v = Number(e.currentTarget.value);
            shiftOther = v === OTHER;
            if (!shiftOther) save({ shiftHz: v });
          }}
        >
          {#each SHIFTS as s (s)}<option value={s}>{s} Hz</option>{/each}
          <option value={OTHER}>Other</option>
        </select>
        <Icon name="updown" size={13} class="row-chevron" />
      </label>
      {#if shiftOther || !(SHIFTS as readonly number[]).includes(r.shiftHz)}
        <label class="row">
          <span class="row-title">Shift in Hz</span>
          <input class="field num" type="text" inputmode="numeric" bind:value={shiftText} onblur={saveShift} onkeydown={blur} autocomplete="off" aria-label="Shift, 50 to 1000 Hz" />
          <span class="unit">Hz</span>
        </label>
      {/if}
      <label class="row">
        <span class="row-main"><span class="row-title">Reverse</span></span>
        <input type="checkbox" role="switch" class="switch" checked={r.reverse} onchange={(e) => setReverse(e.currentTarget.checked)} />
      </label>
      <label class="row">
        <span class="row-main"><span class="row-title">Unshift on space</span></span>
        <input type="checkbox" role="switch" class="switch" checked={r.usos} onchange={(e) => save({ usos: e.currentTarget.checked })} />
      </label>
      <label class="row">
        <span class="row-title">Figures</span>
        <select class="select" value={r.figures} onchange={(e) => save({ figures: e.currentTarget.value === 'ita2' ? 'ita2' : 'us' })}>
          <option value="us">US</option>
          <option value="ita2">ITA2</option>
        </select>
        <Icon name="updown" size={13} class="row-chevron" />
      </label>
    </div>
  </div>

  <div class="section">
    <h2 class="section-head">Receive</h2>
    <div class="group">
      <label class="row">
        <span class="row-main"><span class="row-title">AFC</span></span>
        <input type="checkbox" role="switch" class="switch" checked={r.afc} onchange={(e) => save({ afc: e.currentTarget.checked })} />
      </label>
      <label class="row">
        <span class="row-title">Squelch</span>
        <select class="select" value={r.squelchDb === null ? 'off' : String(r.squelchDb)} onchange={(e) => save({ squelchDb: e.currentTarget.value === 'off' ? null : Number(e.currentTarget.value) })}>
          <option value="off">Off</option>
          {#each SQUELCHES as v (v)}<option value={String(v)}>{db(v)}</option>{/each}
        </select>
        <Icon name="updown" size={13} class="row-chevron" />
      </label>
    </div>
  </div>

  <div class="section">
    <h2 class="section-head">Transmit</h2>
    <div class="group">
      <label class="row">
        <span class="row-title">Stop bits</span>
        <select class="select" value={r.stopBits} onchange={(e) => save({ stopBits: Number(e.currentTarget.value) })}>
          {#each STOP_BITS as b (b)}<option value={b}>{b}</option>{/each}
        </select>
        <Icon name="updown" size={13} class="row-chevron" />
      </label>
      <label class="row">
        <span class="row-title">Preamble</span>
        <select class="select" value={r.preambleS} onchange={(e) => save({ preambleS: Number(e.currentTarget.value) })}>
          {#each PREAMBLES as p (p)}<option value={p}>{p} s</option>{/each}
          {#if !PREAMBLES.includes(r.preambleS)}<option value={r.preambleS}>{r.preambleS} s</option>{/if}
        </select>
        <Icon name="updown" size={13} class="row-chevron" />
      </label>
      <label class="row">
        <span class="row-title">Idle</span>
        <select class="select" value={r.idle} onchange={(e) => save({ idle: e.currentTarget.value === 'mark' ? 'mark' : 'diddle' })}>
          <option value="diddle">Diddle</option>
          <option value="mark">Mark</option>
        </select>
        <Icon name="updown" size={13} class="row-chevron" />
      </label>
      <label class="row">
        <span class="row-title">Tail</span>
        <select class="select" value={r.tailChars} onchange={(e) => save({ tailChars: Number(e.currentTarget.value) })}>
          {#each Array.from({ length: 11 }, (_, i) => i) as n (n)}<option value={n}>{n} {n === 1 ? 'character' : 'characters'}</option>{/each}
        </select>
        <Icon name="updown" size={13} class="row-chevron" />
      </label>
      <label class="row">
        <span class="row-main"><span class="row-title">Start each Tx with a new line</span></span>
        <input type="checkbox" role="switch" class="switch" checked={r.newLineFirst} onchange={(e) => save({ newLineFirst: e.currentTarget.checked })} />
      </label>
      <label class="row">
        <span class="row-title">Stop idle Tx after</span>
        <select
          class="select"
          value={choice(IDLE_STOPS_S, r.idleStopS, idleOther)}
          onchange={(e) => {
            const v = Number(e.currentTarget.value);
            idleOther = v === OTHER;
            if (!idleOther) save({ idleStopS: v });
          }}
        >
          {#each IDLE_STOPS_S as v (v)}<option value={v}>{secondsText(v)}</option>{/each}
          <option value={OTHER}>Other</option>
        </select>
        <Icon name="updown" size={13} class="row-chevron" />
      </label>
      {#if idleOther || !IDLE_STOPS_S.includes(r.idleStopS)}
        <label class="row">
          <span class="row-title">Seconds</span>
          <input class="field num" type="text" inputmode="numeric" bind:value={idleText} onblur={saveIdle} onkeydown={blur} autocomplete="off" aria-label="Stop idle Tx after, s, 10 or more, 0 for off" />
          <span class="unit">s</span>
        </label>
      {/if}
      <label class="row">
        <span class="row-title">Watchdog</span>
        <select
          class="select"
          value={choice(WATCHDOGS, r.watchdogMin, dogOther)}
          onchange={(e) => {
            const v = Number(e.currentTarget.value);
            dogOther = v === OTHER;
            if (!dogOther) save({ watchdogMin: v });
          }}
        >
          {#each WATCHDOGS as v (v)}<option value={v}>{v === 0 ? 'Off' : `${v} min`}</option>{/each}
          <option value={OTHER}>Other</option>
        </select>
        <Icon name="updown" size={13} class="row-chevron" />
      </label>
      {#if dogOther || !WATCHDOGS.includes(r.watchdogMin)}
        <label class="row">
          <span class="row-title">Minutes</span>
          <input class="field num" type="text" inputmode="decimal" bind:value={dogText} onblur={saveDog} onkeydown={blur} autocomplete="off" aria-label="Watchdog, min, 0 for off" />
          <span class="unit">min</span>
        </label>
      {/if}
      <label class="row">
        <span class="row-title">Repeat CQ gap</span>
        <select class="select" value={r.repeatGapS} onchange={(e) => save({ repeatGapS: Number(e.currentTarget.value) })}>
          {#each GAPS as g (g)}<option value={g}>{g} s</option>{/each}
          {#if !GAPS.includes(r.repeatGapS)}<option value={r.repeatGapS}>{r.repeatGapS} s</option>{/if}
        </select>
        <Icon name="updown" size={13} class="row-chevron" />
      </label>
    </div>
  </div>

  <div class="section">
    <div class="group">
      <a class="row link" href={href('settings', 'macros')}>
        <span class="row-main"><span class="row-title">Macros</span></span>
        <span class="row-value">{k.set === 'qso' ? 'QSO' : 'Contest'} · {macroCount}</span>
        <Icon name="chevright" size={13} class="row-chevron" />
      </a>
    </div>
  </div>

  <div class="section">
    <h2 class="section-head">Contest</h2>
    <div class="group">
      <label class="row">
        <span class="row-title">Contest</span>
        <input
          class="field mono"
          type="text"
          bind:value={contestText}
          onblur={() => saveKb({ contestId: normaliseContestId(contestText) })}
          onkeydown={blur}
          placeholder="Optional"
          autocapitalize="characters"
          autocomplete="off"
          spellcheck="false"
          maxlength="32"
          aria-label="Contest, CONTEST_ID such as CQ-WPX-RTTY"
        />
      </label>
      <label class="row">
        <span class="row-title">Next serial</span>
        <input class="field num mono" type="text" inputmode="numeric" bind:value={serialTextField} onblur={saveSerial} onkeydown={blur} autocomplete="off" aria-label="Next serial, 1 to 9999" />
      </label>
      <label class="row">
        <span class="row-title">Serial digits</span>
        <select class="select" value={k.serialDigits} onchange={(e) => saveKb({ serialDigits: Number(e.currentTarget.value) })}>
          {#each [1, 2, 3, 4] as d (d)}<option value={d}>{d} ({serialText(1, d)})</option>{/each}
        </select>
        <Icon name="updown" size={13} class="row-chevron" />
      </label>
      <label class="row">
        <span class="row-title">Exchange</span>
        <input
          class="field mono"
          type="text"
          bind:value={exchangeText}
          onblur={() => saveKb({ exchange: exchangeText.trim().toUpperCase() || '599 {NR}' })}
          onkeydown={blur}
          autocapitalize="characters"
          autocomplete="off"
          spellcheck="false"
          maxlength="60"
        />
      </label>
    </div>
  </div>
</section>

<style>
  .sub {
    padding-top: var(--rr-safe-top);
  }

  .select {
    flex: 1;
    min-width: 0;
    height: var(--rr-tap);
    border: 0;
    background: transparent;
    color: var(--rr-label2);
    font-size: var(--rr-text-body);
    text-align: right;
    text-align-last: right;
    appearance: none;
  }

  .row :global(.row-chevron) {
    margin-left: var(--rr-space-1);
    color: var(--rr-chev);
  }

  .field {
    flex: 1;
    min-width: 0;
    height: var(--rr-tap);
    border: 0;
    background: transparent;
    color: var(--rr-label2);
    font-size: var(--rr-text-body);
    text-align: right;
  }

  .field.num {
    font-variant-numeric: tabular-nums;
  }

  .field::placeholder {
    color: var(--rr-label3);
  }

  .field:focus {
    outline: none;
  }

  .row:has(.field:focus-visible) {
    box-shadow: inset 0 0 0 2px var(--rr-accent);
  }

  .unit {
    flex: none;
    margin-left: var(--rr-space-1);
    color: var(--rr-label2);
  }

  .row-value {
    margin-left: auto;
    text-align: right;
  }
</style>
