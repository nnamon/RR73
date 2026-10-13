<script lang="ts">
  /**
   * Add a QSO by hand, or edit or delete one. Times are UTC. A new QSO joins the running
   * activation unless the operator unticks it. Opened from the Log, the logged notice and Fix.
   */
  import Sheet from './Sheet.svelte';
  import { checkRef, refsLabel } from '../lib/log/activation';
  import { bandOfHz } from '../lib/log/bandplan';
  import { closeEditor, deleteQso, log, logQso, qsoById, restoreQso, updateQso } from '../lib/log/log.svelte';
  import { adifMode, displayMode, formatReport, isGrid, normaliseCall, normaliseGrid, theirFields, theirRefs } from '../lib/log/qso';
  import { PROGRAMMES, type Qso, type Reference } from '../lib/log/types';
  import { BAND_IDS, dialHz, isBand } from '../lib/radio/bands';
  import { settings } from '../lib/state/settings.svelte';

  let open = $state(false);
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
  let join = $state(true);
  let errors = $state<string[]>([]);

  const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const isoTime = (ms: number) => new Date(ms).toISOString().slice(11, 19);
  const mhzText = (hz: number | null) => (hz ? String(Math.round(hz) / 1e6) : '');
  const defaultFreq = (b: string, m: string) => (isBand(b) && (m === 'FT8' || m === 'FT4') ? mhzText(dialHz(b, m)) : '');

  // Each opening starts from the QSO, or from now on the current band for a new one.
  $effect(() => {
    if (log.editor.open && !open) {
      const q = log.editor.qsoId ? (qsoById(log.editor.qsoId) ?? null) : null;
      original = q;
      errors = [];
      const t = q?.start ?? Date.now();
      call = q?.call ?? '';
      date = isoDate(t);
      time = isoTime(t);
      band = q?.band ?? settings.band;
      mode = q ? displayMode(q) : settings.mode;
      freq = q ? mhzText(q.freqHz) : defaultFreq(band, mode);
      grid = q?.gridsquare ?? '';
      sent = q?.rstSent ?? '';
      rcvd = q?.rstRcvd ?? '';
      refs = q ? theirRefs(q).map((r) => r.ref).join(', ') : '';
      comment = q?.comment ?? '';
      join = true;
      open = true;
    }
  });

  function closed() {
    open = false;
    closeEditor();
  }

  const bands = $derived([...new Set([...BAND_IDS, ...(original && !isBand(original.band) && original.band ? [original.band] : [])])]);
  const modes = $derived([...new Set(['FT8', 'FT4', ...(original ? [displayMode(original)] : [])])].filter(Boolean));
  const activation = $derived(original ? log.activations.find((a) => a.id === original!.activationId) : log.current);
  const title = $derived(original ? (original.deletedAt === null ? 'Edit QSO' : 'Deleted QSO') : 'Add QSO');

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
    const problems: string[] = [];
    const c = normaliseCall(call);
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
    if (problems.length) return;

    if (original) {
      const keepMode = mode === displayMode(original) ? { mode: original.mode, submode: original.submode } : adifMode(mode);
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
        ...theirFields(parsed.refs),
      });
    } else {
      await logQso({
        call: c,
        grid: normaliseGrid(grid),
        mode: mode === 'FT4' ? 'FT4' : 'FT8',
        band: band.toLowerCase(),
        dialHz: hz ?? 0,
        audioHz: 0,
        startUtcMs: start,
        endUtcMs: start,
        reportSent: formatReport(sent),
        reportRcvd: formatReport(rcvd),
        comment: comment.trim(),
        theirRefs: parsed.refs,
        source: 'manual',
        activationId: log.current && join ? log.current.id : null,
      });
    }
    open = false;
    closeEditor();
  }

  async function remove() {
    if (!original) return;
    const id = original.id;
    open = false;
    closeEditor();
    await deleteQso(id);
  }

  async function restore() {
    if (!original) return;
    const id = original.id;
    open = false;
    closeEditor();
    await restoreQso(id);
  }
</script>

<Sheet bind:open {title} onclose={closed}>
  <form class="form" onsubmit={save} novalidate>
    {#if errors.length}
      <ul class="errors" role="alert">
        {#each errors as m (m)}<li>{m}</li>{/each}
      </ul>
    {/if}
    <div class="card">
      <label class="row">
        <span class="row-title">Callsign</span>
        <input class="row-field mono up" bind:value={call} autocapitalize="characters" autocomplete="off" spellcheck="false" maxlength="20" placeholder="VK2ESN" />
      </label>
      <label class="row">
        <span class="row-title">Date (UTC)</span>
        <input class="row-field" type="date" bind:value={date} />
      </label>
      <label class="row">
        <span class="row-title">Time (UTC)</span>
        <input class="row-field" type="time" step="1" bind:value={time} />
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
        <input class="row-field mono" bind:value={freq} inputmode="decimal" autocomplete="off" placeholder="14.074" />
      </label>
    </div>

    <div class="card">
      <label class="row">
        <span class="row-title">Their grid</span>
        <input class="row-field mono" bind:value={grid} autocapitalize="characters" autocomplete="off" spellcheck="false" maxlength="8" placeholder="QF56" />
      </label>
      <label class="row">
        <span class="row-title">Report sent</span>
        <input class="row-field mono" bind:value={sent} inputmode="numeric" autocomplete="off" maxlength="4" placeholder="-12" />
      </label>
      <label class="row">
        <span class="row-title">Report received</span>
        <input class="row-field mono" bind:value={rcvd} inputmode="numeric" autocomplete="off" maxlength="4" placeholder="-10" />
      </label>
      <label class="row">
        <span class="row-title">Their park or summit</span>
        <input class="row-field mono up" bind:value={refs} autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="US-1234" />
      </label>
      <label class="row">
        <span class="row-title">Comment</span>
        <input class="row-field" bind:value={comment} autocomplete="off" maxlength="200" />
      </label>
    </div>

    {#if original}
      {#if activation}<p class="note">Part of the activation {refsLabel(activation.refs)}, made as {original.stationCallsign}.</p>{/if}
    {:else if log.current}
      <label class="card row check">
        <span class="row-main">
          <span class="row-title">Add to the activation</span>
          <span class="row-sub">{refsLabel(log.current.refs)}, as {log.current.callsign}</span>
        </span>
        <input type="checkbox" role="switch" class="switch" bind:checked={join} />
      </label>
    {/if}

    {#if original?.deletedAt != null}
      <button type="button" class="btn primary wide" onclick={() => void restore()}>Restore QSO</button>
    {:else}
      <button type="submit" class="btn primary wide">{original ? 'Save QSO' : 'Add QSO'}</button>
    {/if}
    <button type="button" class="btn wide cancel" onclick={closed}>Cancel</button>
    {#if original && original.deletedAt === null}
      <button type="button" class="text-button danger wide" onclick={() => void remove()}>Delete QSO</button>
    {/if}
  </form>
</Sheet>

<style>
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

  .up::placeholder {
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
</style>
