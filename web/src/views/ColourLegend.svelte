<script lang="ts">
  /**
   * Settings › Decode colours › Legend: each way a decode row can look, drawn as a row in the
   * operator's colours, with what it means. The background colours come in the operator's order,
   * enabled ones only; then worked status, the transmission rows, faded and dimmed rows, and the
   * tags at the right of a row.
   */
  import DecodeList, { type DecodeListItem } from '../ui/DecodeList.svelte';
  import { category, isBackground, type HighlightEntry, type HighlightId } from '../lib/decode/highlight';
  import { markDecode, type DecodeRowData } from '../lib/decode/marking';
  import type { RowItem } from '../lib/decode/list';
  import type { LostMark } from '../lib/decode/lost';
  import type { QueueMark } from '../lib/decode/queue';
  import type { ChaseMark } from '../lib/state/spots.svelte';
  import type { DxccIndex } from '../lib/reference';

  let { highlights, me, countries }: { highlights: readonly HighlightEntry[]; me: string; countries: DxccIndex | null } = $props();

  /** The example slot: 13:14:45 UTC. */
  const SLOT = Date.UTC(2026, 9, 21, 13, 14, 45);

  interface Entry {
    key: string;
    title: string;
    text: string;
    item: DecodeListItem;
    nowMs?: number;
    lost?: LostMark[];
    queue?: QueueMark[];
    chase?: ChaseMark;
  }

  const PLACE: Partial<Record<HighlightId, string>> = {
    newContinent: 'a continent',
    newCqZone: 'a CQ zone',
    newItuZone: 'an ITU zone',
    newDxcc: 'a DXCC entity',
    newGrid: 'a grid',
    newCall: 'a station',
  };

  /** What each background colour means. */
  function meaning(id: HighlightId): string {
    const c = category(id);
    if (id === 'myCall') return 'A message with your callsign, portable forms included. A message to you also has a red left edge and heavier text.';
    if (id === 'ending') return 'RR73 or 73 to another station.';
    if (id === 'cq') return 'A CQ.';
    if (id === 'sent') return 'Your transmission, with its time.';
    const base = (c.onBand ? id.replace(/Band$/, '') : id) as HighlightId;
    return `A CQ, 73 or RR73 from ${PLACE[base] ?? 'a station'} not in your log${c.onBand ? ' on this band' : ''}.`;
  }

  /** A CQ from a different station for each colour, so the rows read as real decodes. */
  const CALLS: Record<HighlightId, [string, number]> = {
    myCall: ['{me} JA1KXM PM95', -14],
    newContinent: ['CQ PY2XB GG66', -16],
    newContinentBand: ['CQ LU5FF GF05', -12],
    newCqZone: ['CQ UA0SC NO63', -11],
    newCqZoneBand: ['CQ RA9USU MO05', -9],
    newItuZone: ['CQ ZL1BYZ RF73', -18],
    newItuZoneBand: ['CQ KH6CJJ BK29', -15],
    newDxcc: ['CQ A41ZZ LL93', -4],
    newDxccBand: ['CQ HS0ZIN OK03', -7],
    newGrid: ['CQ JA7BEW QM09', -9],
    newGridBand: ['CQ JA6WFM PM53', -10],
    newCall: ['CQ BV2KI PL05', -13],
    newCallBand: ['CQ DU1AV PK04', -6],
    ending: ['JA8HCE VK2AXN RR73', -8],
    cq: ['CQ 9M2TRX OJ02', -12],
    sent: ['JA1KXM {me} R-14', 0],
    worked: ['CQ JH1RRT QM09', -11],
  };

  function row(key: string, text: string, snr: number, freq: number, opts: { sent?: boolean; item?: Partial<RowItem>; row?: Partial<DecodeRowData> } = {}): DecodeListItem {
    const decode = { text: text.replaceAll('{me}', me), snr_db: snr, dt_s: opts.sent ? 0 : 0.1, freq_hz: freq };
    const marked = markDecode(decode, me, opts.sent);
    return {
      kind: 'row',
      id: key,
      slotStartMs: SLOT,
      ...opts.item,
      row: { decode, ...marked, hl: null, ink: null, time: opts.sent ? '13:14:45' : undefined, ...opts.row },
    };
  }

  const on = $derived(new Set(highlights.filter((e) => e.on).map((e) => e.id)));
  const greyText = $derived(on.has('worked') ? ('worked' as const) : null);

  const colours: Entry[] = $derived(
    highlights
      .filter((e) => e.on && isBackground(e))
      .map((e, i) => {
        const [text, snr] = CALLS[e.id];
        const sent = e.id === 'sent';
        return {
          key: e.id,
          title: category(e.id).label,
          text: meaning(e.id),
          item: row(`hl-${e.id}`, text, snr, 900 + 110 * i, {
            sent,
            item: { toYou: e.id === 'myCall', out: sent ? { stage: 'sent', startMs: SLOT } : undefined },
            row: { hl: e.id },
          }),
        };
      }),
  );

  const worked: Entry[] = $derived([
    {
      key: 'dupe',
      title: 'Dupe',
      text: `Worked today on this band and mode, in the running activation: a solid right edge${greyText ? ', with grey text' : ''}. Hide worked hides it.`,
      item: row('dupe', CALLS.worked[0], CALLS.worked[1], 1320, { row: { hl: on.has('cq') ? 'cq' : null, ink: greyText, worked: true } }),
    },
    {
      key: 'before',
      title: 'Worked on another day',
      text: 'Worked on this band and mode on another day: a right edge in the New call colour. You can work it again.',
      item: row('before', 'CQ JA7XVZ QM09', -13, 1803, { row: { hl: on.has('cq') ? 'cq' : null, before: true } }),
    },
  ]);

  const rows: Entry[] = $derived([
    ...(on.has('myCall')
      ? []
      : [{ key: 'to-you', title: 'To you', text: 'A message to you: a red left edge and heavier text.', item: row('to-you', '{me} JA1KXM PM95', -14, 2397, { item: { toYou: true } }) }]),
    {
      key: 'next',
      title: 'Next',
      text: 'Your next transmission, with its slot and the seconds until it starts.',
      item: row('next', 'JA1KXM {me} R-14', 0, 1500, { sent: true, item: { out: { stage: 'next', startMs: SLOT + 500 } } }),
      nowMs: SLOT - 6_500,
    },
    {
      key: 'sending',
      title: 'Sending',
      text: 'Your transmission on air. The red line shows how much has gone.',
      item: row('sending', 'JA1KXM {me} R-14', 0, 1500, { sent: true, item: { out: { stage: 'sending', startMs: SLOT + 500, endMs: SLOT + 13_140 } } }),
      nowMs: SLOT + 6_000,
    },
    {
      key: 'old',
      title: 'Earlier slot',
      text: 'A decode from a slot before the newest one: faded.',
      item: row('old', 'CQ 9M2TRX OJ02', -12, 1310, { item: { old: true }, row: { hl: on.has('cq') ? 'cq' : null } }),
    },
    {
      key: 'dim',
      title: 'Dimmed',
      text: 'During a QSO, a decode unrelated to the station you are working.',
      item: row('dim', 'BD7PDP 4I1LCT 73', 5, 1084, { item: { dim: true } }),
    },
  ]);

  const tags: Entry[] = $derived([
    {
      key: 'country',
      title: 'Country',
      text: countries ? 'The country of a station calling CQ or calling you.' : 'The country of a station calling CQ or calling you, once the country file has loaded.',
      item: row('country', 'CQ VK2AXN QF56', -8, 1169),
    },
    {
      key: 'queue',
      title: 'Next, 2nd, 3rd',
      text: 'With Repeat CQ on, the order Repeat CQ answers waiting callers in.',
      item: row('queue', '{me} W1AW FN31', -10, 1650, { item: { toYou: true } }),
      queue: [{ call: 'W1AW', slotStartMs: SLOT, tag: 'Next' }],
    },
    {
      key: 'queue-dupe',
      title: 'Dupe',
      text: 'With Repeat CQ on, a waiting caller that is a dupe. Repeat CQ skips it while Work dupes is off.',
      item: row('queue-dupe', '{me} K2LE FN13', -15, 1720, { item: { toYou: true } }),
      queue: [{ call: 'K2LE', slotStartMs: SLOT, tag: 'Dupe' }],
    },
    {
      key: 'lost',
      title: 'Lost',
      text: 'The station you are calling answered another station.',
      item: row('lost', 'JA2KGH YO3GK -09', -6, 1406),
      lost: [{ call: 'YO3GK', other: 'JA2KGH', slotStartMs: SLOT }],
    },
    {
      key: 'chase',
      title: 'Reference',
      text: 'The park or summit reference of the station chosen in Spots.',
      item: row('chase', 'CQ K4SWL EM95', -9, 1250),
      chase: { call: 'K4SWL', text: 'US-0817', spoken: 'spotted, POTA US-0817' },
    },
  ]);

  const SECTIONS = $derived([
    { id: 'legend-colours', head: 'Colours', foot: 'A row takes the first matching colour from the top.', entries: colours },
    { id: 'legend-worked', head: 'Worked', foot: '', entries: worked },
    { id: 'legend-rows', head: 'Rows', foot: '', entries: rows },
    { id: 'legend-tags', head: 'Tags', foot: '', entries: tags },
  ]);
</script>

{#each SECTIONS as s (s.id)}
  {#if s.entries.length}
    <div class="section">
      <h2 class="section-head" id={s.id}>{s.head}</h2>
      <ul class="group legend" aria-labelledby={s.id} data-testid={s.id}>
        {#each s.entries as e (e.key)}
          <li class="lg" data-key={e.key}>
            <DecodeList items={[e.item]} {highlights} {countries} label={e.title} preview nowMs={e.nowMs ?? 0} lost={e.lost ?? []} queue={e.queue ?? []} chase={e.chase ?? null} />
            <span class="lg-text"><span class="row-title">{e.title}</span><span class="row-sub">{e.text}</span></span>
          </li>
        {/each}
      </ul>
      {#if s.foot}<p class="section-foot">{s.foot}</p>{/if}
    </div>
  {/if}
{/each}

<style>
  .legend {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .lg + .lg {
    border-top: var(--rr-hairline) solid var(--rr-sep-strong);
  }

  .lg-text {
    display: flex;
    flex-direction: column;
    gap: var(--rr-space-1);
    padding: var(--rr-space-2) var(--rr-space-4) var(--rr-space-3);
  }
</style>
