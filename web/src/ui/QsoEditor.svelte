<script lang="ts">
  /**
   * Add a QSO by hand, or edit or delete one. Times are UTC. A new QSO joins the running
   * activation unless the operator unticks it; an existing one outside any activation can join the
   * running one, or leave it. An existing QSO shows where it stands at Wavelog,
   * with Send to Wavelog when it is not sent. Opened with a keyboard mode's draft (the QSO strip)
   * it starts from the strip's fields and logs them: Log QSO. Name, QTH and the contest numbers
   * show for RTTY and for any QSO that has them.
   *
   * In the QSO sheet (QsoSheet) on the phone; `inline` in the Log's detail pane beside the list
   * (compact height and regular width), with the callsign as its title, Save QSO in its bar once
   * something changes, and no Cancel: another QSO picked in the list replaces it.
   */
  import { dateText } from '../lib/log/view';
  import { displayName } from '../lib/reference/names';
  import { reference } from '../lib/reference';
  import { checkRef, refsLabel } from '../lib/log/activation';
  import { bandOfHz } from '../lib/log/bandplan';
  import { deleteQso, log, logQso, qsoById, restoreQso, sendToWavelog, updateQso, type QsoDraftInit } from '../lib/log/log.svelte';
  import { stateWords } from '../lib/log/view';
  import { activationPatch, adifMode, displayMode, formatReport, isGrid, normaliseCall, normaliseGrid, theirFields, theirRefs } from '../lib/log/qso';
  import { PROGRAMMES, type Qso, type Reference } from '../lib/log/types';
  import { BAND_IDS, isBand } from '../lib/radio/bands';
  import { operatingDialHz } from '../lib/radio/hound-dial';
  import { rttyDialHz } from '../lib/rtty/dial';
  import { isFt } from '../lib/clock/slots';
  import { features } from '../lib/state/features.svelte';
  import { typedSuggestions, type RefSuggestion } from '../lib/log/ref-suggest';
  import Icon from './Icon.svelte';
  import { settings } from '../lib/state/settings.svelte';
  import { device } from '../lib/app/platform';
  import { utcNow } from '../lib/clock/utc';

  let { qsoId, inline = false, onclose }: { qsoId: string | null; inline?: boolean; onclose: () => void } = $props();

  let original = $state<Qso | null>(null);
  let call = $state('');
  let date = $state('');
  let time = $state('');
  let band = $state('20m');
  let mode = $state('FT8');
  let freq = $state('');
  let grid = $state('');
  let sent = $state('');
  let rcvd = $state('');
  let refs = $state('');
  let comment = $state('');
  let name = $state('');
  let qth = $state('');
  let stx = $state('');
  let srx = $state('');
  let draft = $state.raw<QsoDraftInit | null>(null);
  let join = $state(true);
  let errors = $state<string[]>([]);
  /** True while a save waits for storage, so a second tap cannot log the QSO twice. */
  let saving = $state(false);
  /** The running activation a QSO can join: only with Activations on. */
  const running = $derived(features.activations ? log.current : null);
  /** The reference being typed in Their park or summit: the last one in the field. */
  const lastRef = $derived(refs.split(/[,\s]+/).at(-1) ?? '');
  let refSuggestions = $state<RefSuggestion[]>([]);
  // POTA and SOTA references that begin with it, from the lists Activations brings.
  $effect(() => {
    const t = lastRef;
    const lists = { parks: reference.parks(features.activations), summits: reference.summits(features.activations) };
    const programme = /^[A-Z0-9]{1,4}-\d{0,5}$/i.test(t) ? 'POTA' : t.includes('/') ? 'SOTA' : null;
    let current = true;
    const timer = setTimeout(() => {
      void (programme ? typedSuggestions(programme, t, lists) : Promise.resolve([])).then((x) => {
        if (current) refSuggestions = x.filter((r) => r.ref !== t.toUpperCase());
      });
    }, 120);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  });

  /** Puts a suggested reference in place of the one being typed. */
  function pickRef(r: RefSuggestion) {
    const before = refs.slice(0, refs.length - lastRef.length).replace(/[,\s]*$/, '').toUpperCase();
    refs = before ? `${before}, ${r.ref}` : r.ref;
    refSuggestions = [];
  }

  /** An existing QSO can join the running activation when it is in none, or leave it. */
  const movable = $derived(!!original && !!running && (original.activationId === null || original.activationId === running.id));

  const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const isoTime = (ms: number) => new Date(ms).toISOString().slice(11, 19);
  const mhzText = (hz: number | null) => (hz ? String(Math.round(hz) / 1e6) : '');
  // The dial the band sheet sets for the band and mode.
  const defaultFreq = (b: string, m: string) => (!isBand(b) ? '' : m === 'FT8' || m === 'FT4' ? mhzText(operatingDialHz(b, m, false, {}, settings.ftDialHz)) : m === 'RTTY' ? mhzText(rttyDialHz(b, settings.rtty.dialHz)) : '');

  /** The fields as loaded, to tell an edit in the pane. */
  let loaded = $state('');
  const fields = () => JSON.stringify([call, date, time, band, mode, freq, grid, sent, rcvd, name, qth, stx, srx, refs, comment, join]);

  // Each opening starts from the QSO, or from now on the current band for a new one. The owner
  // mounts the editor afresh for each opening.
  function load() {
    const q = qsoId ? (qsoById(qsoId) ?? null) : null;
    const d = q ? null : (log.editor.draft ?? null);
    original = q;
    draft = d;
    errors = [];
    const t = q?.start ?? d?.startMs ?? utcNow();
    call = q?.call ?? d?.call ?? '';
    date = isoDate(t);
    time = isoTime(t);
    band = q?.band ?? d?.band ?? settings.band;
    // QSOs are FT8, FT4 or RTTY here: WSPR spots never become QSOs.
    mode = q ? displayMode(q) : (d?.mode ?? (isFt(settings.mode) || settings.mode === 'RTTY' ? settings.mode : 'FT8'));
    freq = q ? mhzText(q.freqHz) : d ? mhzText(d.freqHz) : defaultFreq(band, mode);
    grid = q?.gridsquare ?? d?.grid ?? '';
    sent = q?.rstSent ?? d?.rstSent ?? '';
    rcvd = q?.rstRcvd ?? d?.rstRcvd ?? '';
    name = q?.name ?? d?.name ?? '';
    qth = q?.qth ?? d?.qth ?? '';
    stx = q?.stx ?? d?.stx ?? '';
    srx = q?.srx ?? d?.srx ?? '';
    refs = q ? theirRefs(q).map((r) => r.ref).join(', ') : '';
    comment = q?.comment ?? d?.notes ?? '';
    join = q ? !!running && q.activationId === running.id : true;
    loaded = fields();
  }
  load();

  /** The pane's title and the line under the callsign: "14 Oct 2026 · 13:12 UTC · Australia". */
  const changed = $derived(fields() !== loaded);
  let countries = $state.raw(reference.loadedCountries());
  $effect(() => {
    if (inline && !reference.loadedCountries()) void reference.warm().then(() => (countries = reference.loadedCountries()));
  });
  const heroLine = $derived.by(() => {
    if (!original) return '';
    const where = countries?.lookup(original.call);
    const parts = [dateText(original.start), `${isoTime(original.start).slice(0, 5)} UTC`];
    if (where?.found) parts.push(displayName(where.dxccEntity));
    return parts.join(' · ');
  });
  const formId = `qso-form-${Math.random().toString(36).slice(2, 8)}`;

  const bands = $derived([...new Set([...BAND_IDS, ...(original && !isBand(original.band) && original.band ? [original.band] : [])])]);
  const modes = $derived([...new Set(['FT8', 'FT4', 'RTTY', ...(original ? [displayMode(original)] : [])])].filter(Boolean));
  const keyboardRows = $derived(mode === 'RTTY' || !!(name || qth));
  // Contest numbers: with the Contest set in use, or when the QSO has them.
  const numberRows = $derived(!!(stx || srx) || (mode === 'RTTY' && settings.keyboard.set === 'contest'));
  /** Serial numbers only, as RTTY's contest set logs them; FT8 and FT4 log the exchange's words. */
  const numbers = $derived(mode === 'RTTY');
  const activation = $derived(original ? log.activations.find((a) => a.id === original!.activationId) : running);
  const wavelogOn = $derived(log.facts.some((f) => f.id === 'wavelog' && f.active));
  const wavelog = $derived(original ? (log.index.get(original.id)?.find((e) => e.destinationId === 'wavelog') ?? null) : null);
  const canSend = $derived(!!wavelog && (wavelog.state === 'not-sent' || wavelog.state === 'waiting' || wavelog.state === 'refused'));
  const sendReason = $derived(!log.online ? `No connection. Send when the ${device} is online.` : log.sync.running ? 'Wavelog is busy with other QSOs. Try again when they are sent.' : null);
  const wavelogText = $derived.by(() => {
    if (!wavelog) return '';
    const words = stateWords(wavelog.state);
    return `${words[0].toUpperCase()}${words.slice(1)}${wavelog.lastError ? `. ${wavelog.lastError}` : ''}`;
  });

  /** "20261013" or "2026-10-13" as 2026-10-13: the number keypad has no dash. */
  function tidyDate(v: string): string {
    const m = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(v.trim());
    return m ? `${m[1]}-${m[2]}-${m[3]}` : v.trim();
  }

  /** "131452", "1314" or "13:14:52" as 13:14:52 or 13:14: the number keypad has no colon. */
  function tidyTime(v: string): string {
    const m = /^(\d{2}):?(\d{2})(?::?(\d{2}))?$/.exec(v.trim());
    return m ? `${m[1]}:${m[2]}${m[3] ? `:${m[3]}` : ''}` : v.trim();
  }

  /** Keeps the frequency on the band's dial frequency while the operator has not typed one. */
  function changeBandOrMode(nextBand: string, nextMode: string) {
    if (!freq || freq === defaultFreq(band, mode)) freq = defaultFreq(nextBand, nextMode);
    band = nextBand;
    mode = nextMode;
  }

  /** "US-1234, W7O/CN-001" as references, each matched to the programme whose format it has. */
  function parseRefs(text: string): { refs: Reference[]; bad: string[] } {
    const out: Reference[] = [];
    const bad: string[] = [];
    for (const raw of text.split(/[,\s]+/).filter(Boolean)) {
      const p = PROGRAMMES.find((x) => checkRef(x, raw).ok);
      if (p) out.push({ programme: p, ref: (checkRef(p, raw) as { ref: string }).ref });
      else bad.push(raw.toUpperCase());
    }
    return { refs: out, bad };
  }

  async function save(e: SubmitEvent) {
    e.preventDefault();
    if (!(await persist())) return;
    // In the pane the QSO stays open, saved.
    if (inline && original) loaded = fields();
    else onclose();
  }

  /** Saves the form, a new or an edited QSO; false when it says what is wrong instead. */
  async function persist(): Promise<boolean> {
    if (saving) return false;
    const problems: string[] = [];
    const c = normaliseCall(call);
    date = tidyDate(date);
    time = tidyTime(time);
    if (!/[A-Z0-9]/.test(c)) problems.push('Type the other station’s callsign.');
    const start = Date.parse(`${date}T${time.length === 5 ? `${time}:00` : time}Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}(:\d{2})?$/.test(time) || Number.isNaN(start)) problems.push('Type the date and the time in UTC, such as 2026-10-13 and 13:32.');
    const mhz = freq.trim() ? Number(freq.trim().replace(',', '.')) : null;
    const hz = mhz !== null && Number.isFinite(mhz) && mhz > 0 ? Math.round(mhz * 1e6) : null;
    if (mhz !== null && hz === null) problems.push(`${freq.trim()} is not a frequency. Type it in MHz, such as 14.074.`);
    else if (hz !== null && bandOfHz(hz) !== band.toLowerCase()) problems.push(`${mhz} MHz is outside ${band}. Change the band or the frequency.`);
    if (grid.trim() && !isGrid(grid)) problems.push(`${grid.trim().toUpperCase()} is not a grid. Grids look like QF56 or QF56od.`);
    const parsed = parseRefs(refs);
    if (parsed.bad.length) problems.push(`${parsed.bad.join(', ')} ${parsed.bad.length > 1 ? 'are not references' : 'is not a reference'}. They look like US-1234, W7O/CN-001, KFF-1234 or OC-001.`);
    errors = problems;
    if (problems.length) return false;

    saving = true;
    try {
      if (original) {
        const keepMode = mode === displayMode(original) ? { mode: original.mode, submode: original.submode } : adifMode(mode);
        // Joining or leaving the running activation sets its references; what went on air stays.
        const moved = movable && running && join !== (original.activationId === running.id) ? activationPatch(join ? running : null) : {};
        await updateQso(original.id, {
          call: c,
          gridsquare: normaliseGrid(grid),
          band: band.toLowerCase(),
          ...keepMode,
          freqHz: hz,
          start,
          end: start + Math.max(0, original.end - original.start),
          rstSent: formatReport(sent),
          rstRcvd: formatReport(rcvd),
          comment: comment.trim(),
          name: name.trim().toUpperCase(),
          qth: qth.trim().toUpperCase(),
          stx: stx.trim(),
          srx: srx.trim(),
          ...theirFields(parsed.refs),
          ...moved,
        });
      } else {
        await logQso({
          call: c,
          grid: normaliseGrid(grid),
          mode: mode === 'FT4' ? 'FT4' : mode === 'RTTY' ? 'RTTY' : 'FT8',
          band: band.toLowerCase(),
          dialHz: hz ?? 0,
          audioHz: 0,
          startUtcMs: start,
          endUtcMs: start,
          reportSent: formatReport(sent),
          reportRcvd: formatReport(rcvd),
          comment: comment.trim(),
          name,
          qth,
          stx,
          srx,
          contestId: draft?.contestId ?? '',
          theirRefs: parsed.refs,
          source: draft ? 'keyboard' : 'manual',
          activationId: running && join ? running.id : null,
        });
        draft?.onlogged();
      }
    } finally {
      saving = false;
    }
    return true;
  }

  /** Saves any edit, then sends this QSO to Wavelog; the result shows as a notice. */
  async function sendOne() {
    if (!original) return;
    const id = original.id;
    if (!(await persist())) return;
    if (inline) loaded = fields();
    else onclose();
    await sendToWavelog([id]);
  }

  async function remove() {
    if (!original) return;
    const id = original.id;
    onclose();
    await deleteQso(id);
  }

  async function restore() {
    if (!original) return;
    const id = original.id;
    onclose();
    await restoreQso(id);
  }
</script>

{#if inline}
  <div class="pane-editor">
    <div class="nb">
      <h2 class="nb-title">{original ? original.call : 'Add QSO'}</h2>
      {#if original?.deletedAt == null}
        <button type="submit" class="act" form={formId} disabled={saving || (!!original && !changed)}>{original ? 'Save QSO' : draft ? 'Log QSO' : 'Add QSO'}</button>
      {/if}
    </div>
    <div class="rd">
      {#if original}
        <div class="hero">
          <p class="cs mono">{original.call}</p>
          <p class="when">{heroLine}</p>
        </div>
      {/if}
      {@render body()}
    </div>
  </div>
{:else}
  {@render body()}
{/if}

{#snippet body()}
  <form class="form" id={formId} onsubmit={save} novalidate>
    {#if errors.length}
      <div role="alert"><ul class="errors">
        {#each errors as m (m)}<li>{m}</li>{/each}
      </ul></div>
    {/if}
    <div class="card">
      <label class="row">
        <span class="row-title">Callsign</span>
        <input class="row-field mono up" bind:value={call} autocapitalize="characters" autocomplete="off" spellcheck="false" maxlength="20" placeholder="Required" />
      </label>
      <label class="row">
        <span class="row-title">Date (UTC)</span>
        <input class="row-field mono" bind:value={date} onblur={() => (date = tidyDate(date))} inputmode="numeric" autocomplete="off" spellcheck="false" maxlength="10" placeholder="YYYY-MM-DD" />
      </label>
      <label class="row">
        <span class="row-title">Time (UTC)</span>
        <input class="row-field mono" bind:value={time} onblur={() => (time = tidyTime(time))} inputmode="numeric" autocomplete="off" spellcheck="false" maxlength="8" placeholder="HH:MM:SS" />
      </label>
    </div>

    <div class="card">
      <label class="row">
        <span class="row-title">Band</span>
        <select class="row-field" value={band} onchange={(e) => changeBandOrMode(e.currentTarget.value, mode)}>
          {#each bands as b (b)}<option value={b}>{b}</option>{/each}
        </select>
      </label>
      <label class="row">
        <span class="row-title">Mode</span>
        <select class="row-field" value={mode} onchange={(e) => changeBandOrMode(band, e.currentTarget.value)}>
          {#each modes as m (m)}<option value={m}>{m}</option>{/each}
        </select>
      </label>
      <label class="row">
        <span class="row-title">Frequency (MHz)</span>
        <input class="row-field mono" bind:value={freq} inputmode="decimal" autocomplete="off" placeholder="Optional" />
      </label>
    </div>

    <div class="card">
      <label class="row">
        <span class="row-title">Their grid</span>
        <input class="row-field mono" bind:value={grid} autocapitalize="characters" autocomplete="off" spellcheck="false" maxlength="8" placeholder="Optional" />
      </label>
      <label class="row">
        <span class="row-title">Report sent</span>
        <input class="row-field mono" bind:value={sent} autocomplete="off" spellcheck="false" maxlength="4" placeholder="Optional" />
      </label>
      <label class="row">
        <span class="row-title">Report received</span>
        <input class="row-field mono" bind:value={rcvd} autocomplete="off" spellcheck="false" maxlength="4" placeholder="Optional" />
      </label>
      {#if keyboardRows}
        <label class="row">
          <span class="row-title">Name</span>
          <input class="row-field mono up" bind:value={name} autocapitalize="characters" autocomplete="off" spellcheck="false" maxlength="20" placeholder="Optional" />
        </label>
        <label class="row">
          <span class="row-title">QTH</span>
          <input class="row-field mono up" bind:value={qth} autocapitalize="characters" autocomplete="off" spellcheck="false" maxlength="30" placeholder="Optional" />
        </label>
      {/if}
      {#if numberRows}
        <!-- RTTY's contest set sends serial numbers; FT8 and FT4 store the exchange as sent and received (Custom exchange). -->
        <label class="row">
          <span class="row-title">{numbers ? 'Number sent' : 'Exchange sent'}</span>
          <input class="row-field mono up" bind:value={stx} inputmode={numbers ? 'numeric' : 'text'} autocapitalize="characters" autocomplete="off" spellcheck="false" maxlength={numbers ? 6 : 20} placeholder="Optional" />
        </label>
        <label class="row">
          <span class="row-title">{numbers ? 'Number received' : 'Exchange received'}</span>
          <input class="row-field mono up" bind:value={srx} inputmode={numbers ? 'numeric' : 'text'} autocapitalize="characters" autocomplete="off" spellcheck="false" maxlength={numbers ? 6 : 20} placeholder="Optional" />
        </label>
      {/if}
      <label class="row">
        <span class="row-title">Their park or summit</span>
        <input class="row-field mono up" bind:value={refs} autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="Optional" />
      </label>
      {#each refSuggestions as r (r.ref)}
        <button type="button" class="row sug" aria-label="Use {r.programme} {r.ref}, {r.name}" onclick={() => pickRef(r)}>
          <span class="row-main">
            <span class="mono sug-ref">{r.ref}</span>
            <span class="row-sub sug-name">{r.name}</span>
          </span>
          <Icon name={r.programme === 'POTA' ? 'tree' : 'mountain'} size={18} class="sug-i" />
        </button>
      {/each}
      <label class="row">
        <span class="row-title">Comment</span>
        <input class="row-field" bind:value={comment} autocomplete="off" maxlength="200" placeholder="Optional" />
      </label>
    </div>

    {#if original && movable && running}
      <label class="card row check">
        <span class="row-main">
          <span class="row-title">Part of the activation</span>
          <span class="row-sub">{refsLabel(running.refs)}{original.stationCallsign && original.stationCallsign !== running.callsign ? `, made as ${original.stationCallsign}` : ''}</span>
        </span>
        <input type="checkbox" role="switch" class="switch" bind:checked={join} />
      </label>
    {:else if original}
      {#if activation}<p class="note">Part of the activation {refsLabel(activation.refs)}, made as {original.stationCallsign}.</p>{/if}
    {:else if running}
      <label class="card row check">
        <span class="row-main">
          <span class="row-title">Add to the activation</span>
          <span class="row-sub">{refsLabel(running.refs)}, as {running.callsign}</span>
        </span>
        <input type="checkbox" role="switch" class="switch" bind:checked={join} />
      </label>
    {/if}

    {#if original && original.deletedAt === null && wavelogOn && wavelog}
      <div class="card wl">
        <div class="row">
          <span class="row-main">
            <span class="row-title">Wavelog</span>
            <span class="row-sub">{wavelogText}</span>
          </span>
        </div>
        {#if canSend}
          <button type="button" class="row send" disabled={!!sendReason} aria-describedby={sendReason ? 'qso-send-reason' : undefined} onclick={() => void sendOne()}>
            <span class="row-title">Send to Wavelog</span>
          </button>
        {/if}
      </div>
      {#if canSend && sendReason}<p class="note" id="qso-send-reason">{sendReason}</p>{/if}
    {/if}

    {#if original?.deletedAt != null}
      <button type="button" class="btn primary wide" onclick={() => void restore()}>Restore QSO</button>
    {:else if !inline}
      <button type="submit" class="btn primary wide" disabled={saving}>{original ? 'Save QSO' : draft ? 'Log QSO' : 'Add QSO'}</button>
    {/if}
    {#if !inline}<button type="button" class="btn wide cancel" onclick={onclose}>Cancel</button>{/if}
    {#if original && original.deletedAt === null}
      {#if inline}
        <div class="card del"><button type="button" class="row danger" onclick={() => void remove()}><span class="row-title">Delete QSO</span></button></div>
      {:else}
        <button type="button" class="text-button danger wide" onclick={() => void remove()}>Delete QSO</button>
      {/if}
    {/if}
  </form>
{/snippet}

<style>
  .sug-ref {
    font-weight: var(--rr-weight-bold);
  }

  .sug-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sug :global(.sug-i) {
    color: var(--rr-accent);
  }

  .form {
    margin-top: var(--rr-space-3);
  }

  .card {
    overflow: hidden;
    border-radius: var(--rr-radius-xl);
    background: var(--rr-sheet-card);
  }

  .card + .card {
    margin-top: var(--rr-space-3);
  }

  .card .row-title {
    flex: none;
  }

  .up {
    text-transform: uppercase;
  }

  .up::placeholder,
  .row-field::placeholder {
    font-family: var(--rr-sans);
    text-transform: none;
  }

  select.row-field {
    appearance: none;
    text-align-last: right;
    color: var(--rr-label);
  }

  .check {
    margin-top: var(--rr-space-3);
    cursor: pointer;
  }

  .wl {
    margin-top: var(--rr-space-3);
  }

  .send {
    color: var(--rr-accent);
  }

  .send:disabled {
    opacity: 0.4;
  }

  .errors {
    margin-bottom: var(--rr-space-3);
    padding: var(--rr-space-2) var(--rr-space-4);
    border-radius: var(--rr-radius-xl);
    background: var(--rr-tx-soft);
    color: var(--rr-tx-text);
    font-size: var(--rr-text-sub);
    line-height: var(--rr-leading-sub);
  }

  .errors li + li {
    margin-top: var(--rr-space-1);
  }

  .note {
    margin: var(--rr-space-3) var(--rr-space-1) 0;
    font-size: var(--rr-text-foot);
    line-height: var(--rr-leading-row);
    color: var(--rr-label2);
  }

  .wide {
    display: flex;
    justify-content: center;
    width: 100%;
    margin-top: var(--rr-space-3);
  }

  .cancel {
    margin-top: var(--rr-space-2);
    background: transparent;
    color: var(--rr-accent);
  }

  /* In the Log's detail pane: a bar with the title and Save QSO, then the form in a column. */
  .pane-editor {
    min-height: 100%;
    background: var(--rr-bg);
  }

  .nb {
    position: sticky;
    top: 0;
    z-index: 2;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    height: var(--rr-tap);
    padding: 0 var(--rr-space-2);
    background: var(--rr-bg);
  }

  .nb-title {
    position: absolute;
    inset: 0 120px;
    overflow: hidden;
    font-size: var(--rr-text-body);
    font-weight: var(--rr-weight-semibold);
    line-height: var(--rr-tap);
    text-align: center;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .act {
    position: relative;
    min-height: var(--rr-tap);
    padding: 0 var(--rr-space-2);
    color: var(--rr-accent);
    font-size: var(--rr-text-body);
    font-weight: var(--rr-weight-semibold);
  }

  .act:disabled {
    opacity: 0.35;
  }

  .act:focus-visible {
    outline: 2px solid var(--rr-accent);
    outline-offset: -2px;
    border-radius: var(--rr-radius-l);
  }

  .rd {
    max-width: var(--rr-form);
    margin: 0 auto;
    padding: 0 calc(var(--rr-space-4) + var(--rr-safe-right)) var(--rr-space-8) var(--rr-space-4);
  }

  .hero {
    padding: var(--rr-space-1) var(--rr-space-4) var(--rr-space-1-5);
  }

  .hero .cs {
    font-size: var(--rr-hero);
    font-weight: var(--rr-weight-bold);
    line-height: var(--rr-leading-title);
  }

  .hero .when {
    font-size: var(--rr-text-sub);
    line-height: var(--rr-leading-sub);
    color: var(--rr-label2);
  }

  .pane-editor .form {
    margin-top: var(--rr-space-2);
  }

  .pane-editor .card {
    background: var(--rr-surface);
  }

  .del {
    margin-top: var(--rr-space-6);
  }

  .del .danger {
    color: var(--rr-tx-text);
  }
</style>
