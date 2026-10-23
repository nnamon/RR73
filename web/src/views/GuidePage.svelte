<script lang="ts">
  /**
   * One page of the Guide, as Version history shows the changelog: each section a header over a
   * group, each paragraph and list item a row. Links to other pages open them here; `focus` names
   * a section to scroll to. A screenshot's legend repeats the numbered circles burned into it
   * (web/e2e/guide-shots.spec.ts); a ladder draws a QSO as messages between You and Them.
   */
  import { tick } from 'svelte';
  import files, { images } from 'virtual:guide';
  import BackLink from '../ui/BackLink.svelte';
  import { href } from '../lib/app/router.svelte';
  import { parseGuidePage, type Span } from '../lib/app/guide';

  let { slug, focus = null }: { slug: string; focus?: string | null } = $props();

  const page = $derived(slug !== 'index' && files[slug] ? parseGuidePage(slug, files[slug]) : null);

  $effect(() => {
    const id = focus;
    void page;
    void tick().then(() => {
      const el = id ? document.getElementById(`guide-${id}`) : null;
      el?.scrollIntoView({ block: 'start' });
      el?.focus({ preventScroll: true });
    });
  });
</script>

{#snippet spans(list: Span[])}
  {#each list as s, i (i)}
    {#if s.kind === 'code'}<code class="msg">{s.text}</code>
    {:else if s.kind === 'page'}<a class="in" href={s.anchor ? href('settings', 'guide', s.slug, s.anchor) : href('settings', 'guide', s.slug)}>{s.text}</a>
    {:else if s.kind === 'web'}<a class="in" href={s.url} target="_blank" rel="noopener noreferrer">{s.text}</a>
    {:else}{s.text}{/if}
  {/each}
{/snippet}

<section class="screen sub" aria-labelledby="guide-page-title">
  <BackLink to={href('settings', 'guide')} label="Guide" title={page?.title ?? 'Guide'} id="guide-page-title" />

  {#if !page}
    <div class="empty">
      <h2>No such page in this version</h2>
      <p>Settings › Guide lists the guide's pages.</p>
    </div>
  {:else}
    {#each page.sections as s, si (si)}
      <div class="section">
        {#if s.heading}<h2 class="section-head" id="guide-{s.id}" tabindex="-1">{s.heading}</h2>{/if}
        <div class="group">
          {#each s.blocks as b, bi (bi)}
            {#if b.kind === 'p'}
              <p class="row text">{@render spans(b.spans)}</p>
            {:else if b.kind === 'figure'}
              <figure class="row fig">
                {#if images[b.src]}<img src={images[b.src]} alt={b.alt} />{:else}<span class="text">{b.alt}</span>{/if}
              </figure>
              {#if b.legend.length}
                <ol class="items" aria-label="Callouts">
                  {#each b.legend as item, ii (ii)}
                    <li class="row text item"><span class="num" aria-hidden="true">{ii + 1}</span><span class="row-main"><span class="visually-hidden">{ii + 1}. </span>{@render spans(item)}</span></li>
                  {/each}
                </ol>
              {/if}
            {:else if b.kind === 'table'}
              <div class="row tbl">
                <table>
                  <thead><tr>{#each b.head as c, ci (ci)}<th scope="col">{@render spans(c)}</th>{/each}</tr></thead>
                  <tbody>
                    {#each b.rows as r, ri (ri)}<tr>{#each r as c, ci (ci)}<td>{@render spans(c)}</td>{/each}</tr>{/each}
                  </tbody>
                </table>
              </div>
            {:else if b.kind === 'ladder'}
              <div class="row ladder">
                <div class="sides" aria-hidden="true"><span>You</span><span>Them</span></div>
                <ol class="rungs" aria-label="Messages, one per slot">
                  {#each b.rungs as r, ri (ri)}
                    <li class="rung {r.side}">
                      <span class="visually-hidden">{r.side === 'you' ? 'You' : 'Them'}: </span>
                      {#if r.text}<code class="bubble">{r.text}</code>{:else}<span class="bubble none">{r.side === 'you' ? 'Nothing sent' : 'Nothing decoded'}</span>{/if}
                      {#if r.note.length}<span class="note">{@render spans(r.note)}</span>{/if}
                    </li>
                  {/each}
                </ol>
              </div>
            {:else}
              <svelte:element this={b.kind} class="items">
                {#each b.items as item, ii (ii)}
                  <li class="row text item">
                    <span class="mark" aria-hidden="true">{b.kind === 'ol' ? `${ii + 1}.` : '•'}</span>
                    <span class="row-main">{@render spans(item)}</span>
                  </li>
                {/each}
              </svelte:element>
            {/if}
          {/each}
        </div>
      </div>
    {/each}
  {/if}
</section>

<style>
  .sub {
    padding-top: var(--rr-safe-top);
  }

  .section-head {
    scroll-margin-top: var(--rr-space-4);
  }

  .text {
    display: block;
    font-size: var(--rr-text-sub);
    line-height: var(--rr-leading-sub);
  }

  /* Rows of a list follow the rows before them in one group, each with its own separator. */
  .items {
    display: contents;
  }

  /* Rows on either side of a list or legend: the separator base.css draws between sibling rows. */
  .row + .items > .item:first-child::before,
  .items + .row::before,
  .items + .items > .item:first-child::before {
    content: '';
    position: absolute;
    top: 0;
    right: 0;
    left: var(--rr-space-4);
    height: var(--rr-hairline);
    background: var(--rr-sep);
    transform: scaleY(0.5);
    transform-origin: 0 0;
  }

  .item {
    display: flex;
    gap: var(--rr-space-2);
    align-items: baseline;
  }

  .mark {
    flex: none;
    min-width: var(--rr-space-4);
    color: var(--rr-label2);
    font-variant-numeric: tabular-nums;
  }

  .msg {
    font-family: var(--rr-mono);
    font-size: var(--rr-text-sub);
  }

  .in {
    color: var(--rr-accent);
  }

  .fig {
    display: block;
    margin: 0;
    padding: var(--rr-space-3) var(--rr-space-4);
  }

  .fig img {
    display: block;
    width: 100%;
    height: auto;
    border: var(--rr-hairline) solid var(--rr-sep);
    border-radius: var(--rr-radius-m);
  }

  /* The callout circles as burned into the screenshots. */
  .num {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: var(--rr-ring);
    height: var(--rr-ring);
    border-radius: var(--rr-radius-pill);
    background: var(--rr-accent-fill);
    color: var(--rr-on-fill);
    font-size: var(--rr-text-caption);
    font-weight: var(--rr-weight-bold);
    font-variant-numeric: tabular-nums;
    transform: translateY(-1px);
  }

  .item:has(> .num) {
    align-items: center;
  }

  .tbl {
    display: block;
    overflow-x: auto;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--rr-text-sub);
    line-height: var(--rr-leading-sub);
  }

  th {
    padding: 0 var(--rr-space-3) var(--rr-space-1) 0;
    font-size: var(--rr-text-foot);
    font-weight: var(--rr-weight-regular);
    color: var(--rr-label2);
    text-align: left;
  }

  td {
    padding: var(--rr-space-1-5) var(--rr-space-3) var(--rr-space-1-5) 0;
    border-top: var(--rr-hairline) solid var(--rr-sep);
    vertical-align: top;
  }

  th:last-child,
  td:last-child {
    padding-right: 0;
  }

  /* The first column names the row: at most 40% of the width, wrapped by word. */
  td:first-child {
    width: 40%;
    color: var(--rr-label);
    font-weight: var(--rr-weight-medium);
  }

  .ladder {
    display: block;
    padding-block: var(--rr-space-3);
  }

  .sides {
    display: flex;
    justify-content: space-between;
    padding-bottom: var(--rr-space-2);
    font-size: var(--rr-text-foot);
    font-weight: var(--rr-weight-semibold);
    color: var(--rr-label2);
  }

  .rungs {
    display: flex;
    flex-direction: column;
    gap: var(--rr-space-2);
  }

  /* One slot per line: You on the left, Them on the right, each note under its message. */
  .rung {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--rr-space-half);
  }

  .rung.them {
    align-items: flex-end;
  }

  .bubble {
    max-width: 80%;
    padding: var(--rr-space-1) var(--rr-space-2);
    border-radius: var(--rr-radius-m);
    font-family: var(--rr-mono);
    font-size: var(--rr-text-row);
    line-height: var(--rr-leading-row);
    overflow-wrap: anywhere;
  }

  .you .bubble {
    background: var(--rr-accent-soft);
    color: var(--rr-label);
  }

  .them .bubble {
    background: var(--rr-fill3);
    color: var(--rr-label);
  }

  .bubble.none {
    border: var(--rr-hairline) dashed var(--rr-sep-strong);
    background: none;
    font-family: var(--rr-sans);
    font-size: var(--rr-text-foot);
    color: var(--rr-label2);
  }

  .note {
    max-width: 80%;
    font-size: var(--rr-text-foot);
    line-height: var(--rr-leading-foot);
    color: var(--rr-label2);
  }

  .them .note {
    text-align: right;
  }
</style>
