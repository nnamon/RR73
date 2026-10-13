<script lang="ts">
  /**
   * References, the callsign used on air, the grid (typed, or from GPS when permitted) and the
   * Wavelog station location for an activation, in the start and edit sheet (ActivationSheet).
   */
  import Icon from './Icon.svelte';
  import { checkRef, checkRefs, gridFromLatLon, refExample } from '../lib/log/activation';
  import { log, wavelogReady, type ActivationInput } from '../lib/log/log.svelte';
  import { isGrid, normaliseCall, normaliseGrid } from '../lib/log/qso';
  import { PROGRAMMES, type Activation, type Programme, type Reference } from '../lib/log/types';
  import { settings } from '../lib/state/settings.svelte';

  let { initial = null, submitLabel, onsubmit, oncancel }: { initial?: Activation | null; submitLabel: string; onsubmit: (input: ActivationInput) => Promise<void>; oncancel?: () => void } = $props();

  // A form edits its own copy; the running activation changes only on submit.
  // svelte-ignore state_referenced_locally
  let refs = $state<Reference[]>(initial ? [...initial.refs] : []);
  let programme = $state<Programme>('POTA');
  let refText = $state('');
  let refError = $state('');
  // svelte-ignore state_referenced_locally
  let callsign = $state(initial?.callsign ?? settings.callsign);
  // svelte-ignore state_referenced_locally
  let grid = $state(initial?.grid ?? '');
  // svelte-ignore state_referenced_locally
  let gridSource = $state<Activation['gridSource']>(initial?.gridSource ?? 'none');
  // svelte-ignore state_referenced_locally
  let station = $state<string>(initial?.wavelogStationId ?? log.wavelog.stationId ?? '');
  let gps = $state<'idle' | 'finding' | string>('idle');
  let errors = $state<string[]>([]);
  let busy = $state(false);

  const stations = $derived(wavelogReady(log.wavelog) ? log.wavelog.stations : []);
  const chosen = $derived(stations.find((s) => s.id === station) ?? null);
  const onAir = $derived(normaliseCall(callsign));
  const mismatch = $derived(chosen && onAir && chosen.callsign !== onAir ? `Wavelog refuses QSOs made as ${onAir} under ${chosen.name}, which is for ${chosen.callsign}. Choose a station location for ${onAir}.` : '');

  function addRef(e?: Event) {
    e?.preventDefault();
    const r = checkRef(programme, refText);
    if (!r.ok) {
      refError = r.message;
      return;
    }
    const next = [...refs, { programme, ref: r.ref }];
    const problem = checkRefs(next);
    if (problem) {
      refError = problem;
      return;
    }
    refs = next;
    refText = '';
    refError = '';
  }

  function removeRef(i: number) {
    refs = refs.filter((_, j) => j !== i);
  }

  function useGps() {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      gps = 'This browser gives RR73 no location. Type the grid.';
      return;
    }
    gps = 'finding';
    navigator.geolocation.getCurrentPosition(
      (p) => {
        grid = gridFromLatLon(p.coords.latitude, p.coords.longitude);
        gridSource = 'gps';
        gps = 'idle';
      },
      (err) => {
        gps =
          err.code === err.PERMISSION_DENIED
            ? 'Location is off for RR73. Allow it in iOS Settings › Privacy, or type the grid.'
            : err.code === err.TIMEOUT
              ? 'No position within 20 s. Type the grid, or try again in the open.'
              : 'The phone could not find its position. Type the grid.';
      },
      { enableHighAccuracy: false, timeout: 20_000, maximumAge: 600_000 },
    );
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    const problems: string[] = [];
    // A reference typed but not added yet counts.
    let list = refs;
    if (refText.trim()) {
      const r = checkRef(programme, refText);
      if (r.ok) list = [...refs, { programme, ref: r.ref }];
      else problems.push(r.message);
    }
    const setProblem = checkRefs(list);
    if (setProblem) problems.push(setProblem);
    if (!/[A-Z0-9]/.test(onAir)) problems.push('Type the callsign you use on air, such as VK3/9V1NE.');
    if (grid.trim() && !isGrid(grid)) problems.push(`${grid.trim().toUpperCase()} is not a grid. Grids look like QF22 or QF22lb.`);
    errors = problems;
    if (problems.length) return;
    busy = true;
    try {
      refs = list;
      refText = '';
      await onsubmit({
        refs: list,
        callsign: onAir,
        operator: normaliseCall(settings.callsign) || onAir,
        grid: normaliseGrid(grid),
        gridSource: grid.trim() ? gridSource : 'none',
        wavelogStationId: station || null,
      });
    } catch (err) {
      errors = [err instanceof Error ? err.message : 'The activation could not be saved.'];
    } finally {
      busy = false;
    }
  }
</script>

<form class="form" onsubmit={submit} novalidate>
  {#if errors.length}
    <div role="alert"><ul class="errors">
      {#each errors as m (m)}<li>{m}</li>{/each}
    </ul></div>
  {/if}

  <div class="block">
    <h3 class="section-head" id="refs-head">References</h3>
    <div class="group card" role="group" aria-labelledby="refs-head">
      {#each refs as r, i (`${r.programme} ${r.ref}`)}
        <div class="row">
          <span class="prog">{r.programme}</span>
          <span class="row-main mono ref">{r.ref}</span>
          <button type="button" class="remove" aria-label="Remove {r.programme} {r.ref}" onclick={() => removeRef(i)}><Icon name="xmark" size={18} /></button>
        </div>
      {/each}
      <div class="row add">
        <label class="visually-hidden" for="ref-programme">Programme</label>
        <span class="picker">
          <select id="ref-programme" class="prog-select" bind:value={programme}>
            {#each PROGRAMMES as p (p)}<option value={p}>{p}</option>{/each}
          </select>
          <Icon name="chevdown" size={14} class="picker-i" />
        </span>
        <label class="visually-hidden" for="ref-text">Reference</label>
        <input
          id="ref-text"
          class="ref-input mono"
          bind:value={refText}
          placeholder={refExample(programme)}
          autocapitalize="characters"
          autocomplete="off"
          spellcheck="false"
          onkeydown={(e) => e.key === 'Enter' && addRef(e)}
        />
        <button type="button" class="btn compact soft" onclick={() => addRef()}>Add</button>
      </div>
    </div>
    {#if refError}<p class="section-foot err" role="alert">{refError}</p>{:else}<p class="section-foot">POTA parks, SOTA summits, WWFF references and IOTA groups. One activation can hold several parks.</p>{/if}
  </div>

  <div class="block">
    <h3 class="section-head">Station</h3>
    <div class="group card">
      <label class="row">
        <span class="row-title">Callsign on air</span>
        <input class="row-field mono up" bind:value={callsign} autocapitalize="characters" autocomplete="off" spellcheck="false" maxlength="20" placeholder="Required" />
      </label>
      <div class="row">
        <label class="row-title" for="act-grid">Grid</label>
        <input id="act-grid" class="row-field mono" bind:value={grid} oninput={() => (gridSource = 'typed')} autocapitalize="characters" autocomplete="off" spellcheck="false" maxlength="8" placeholder="Optional" />
        <button type="button" class="btn compact soft gps" disabled={gps === 'finding'} onclick={useGps}>
          <Icon name="locate" size={18} /><span>{gps === 'finding' ? 'Finding' : 'Use GPS'}</span>
        </button>
      </div>
      {#if stations.length}
        <label class="row">
          <span class="row-title">Wavelog station</span>
          <select class="row-field" bind:value={station}>
            {#each stations as s (s.id)}<option value={s.id}>{s.name} ({s.callsign})</option>{/each}
          </select>
        </label>
      {/if}
    </div>
    {#if gps !== 'idle' && gps !== 'finding'}<p class="section-foot err" role="alert">{gps}</p>{/if}
    {#if mismatch}<p class="section-foot err">{mismatch}</p>{:else if stations.length}<p class="section-foot">QSOs of this activation go to this Wavelog station location.</p>{/if}
  </div>

  <div class="block buttons">
    <button type="submit" class="btn primary" disabled={busy}>{submitLabel}</button>
    {#if oncancel}<button type="button" class="btn cancel" onclick={oncancel}>Cancel</button>{/if}
  </div>
</form>

<style>
  .prog {
    flex: none;
    width: 48px;
    font-size: var(--rr-text-foot);
    font-weight: var(--rr-weight-bold);
    color: var(--rr-label2);
  }

  .ref {
    font-size: var(--rr-text-body);
    font-weight: var(--rr-weight-bold);
  }

  .remove {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--rr-tap);
    height: var(--rr-tap);
    margin-right: calc(-1 * var(--rr-space-3));
    color: var(--rr-label2);
  }

  .add {
    gap: var(--rr-space-2);
  }

  .picker {
    position: relative;
    flex: none;
  }

  .prog-select {
    height: var(--rr-tap);
    padding: 0 var(--rr-space-6) 0 var(--rr-space-3);
    border: 0;
    border-radius: var(--rr-radius-m);
    background: var(--rr-fill);
    color: var(--rr-label);
    font-size: var(--rr-text-sub);
    font-weight: var(--rr-weight-semibold);
    appearance: none;
  }

  .prog-select:focus-visible {
    outline: 2px solid var(--rr-accent);
    outline-offset: 2px;
  }

  .picker :global(.picker-i) {
    position: absolute;
    top: 50%;
    right: var(--rr-space-2);
    color: var(--rr-label2);
    transform: translateY(-50%);
    pointer-events: none;
  }

  .ref-input {
    flex: 1;
    min-width: 0;
    height: var(--rr-tap);
    border: 0;
    background: transparent;
    color: var(--rr-label);
    font-size: var(--rr-text-body);
    text-transform: uppercase;
  }

  .ref-input::placeholder,
  .up::placeholder {
    color: var(--rr-label3);
    font-family: var(--rr-sans);
    text-transform: none;
  }

  #act-grid::placeholder {
    font-family: var(--rr-sans);
  }

  .ref-input:focus {
    outline: none;
  }

  .row:has(.ref-input:focus-visible) {
    box-shadow: inset 0 0 0 2px var(--rr-accent);
  }

  .up {
    text-transform: uppercase;
  }

  .row-title {
    flex: none;
  }

  select.row-field {
    appearance: none;
    text-align-last: right;
  }

  /* On the sheet's card the tinted fill is too light for its text in dark mode. */
  .soft {
    background: var(--rr-fill2);
    color: var(--rr-accent);
  }

  .gps {
    gap: var(--rr-space-1);
    padding: 0 var(--rr-space-2);
  }

  .err {
    color: var(--rr-tx-text);
  }

  .block {
    margin-top: var(--rr-space-4);
  }

  .card {
    background: var(--rr-sheet-card);
  }

  .errors {
    margin: var(--rr-space-3) 0 0;
    padding: var(--rr-space-2) var(--rr-space-4);
    border-radius: var(--rr-radius-xl);
    background: var(--rr-tx-soft);
    color: var(--rr-tx-text);
    font-size: var(--rr-text-sub);
    line-height: var(--rr-leading-sub);
  }

  .buttons {
    display: flex;
    flex-direction: column;
    gap: var(--rr-space-2);
  }

  .cancel {
    background: transparent;
    color: var(--rr-accent);
  }
</style>
