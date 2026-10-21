<script lang="ts">
  /** Credits: the third-party work in RR73 and each licence in full, from THIRD_PARTY_NOTICES.md. */
  import notices from 'virtual:notices';
  import BackLink from '../ui/BackLink.svelte';
  import { href } from '../lib/app/router.svelte';
  import { parseNotices } from '../lib/app/notices';

  const list = parseNotices(notices);

  /** What each work gives RR73, by its heading in the notices. */
  const USES: Record<string, string> = {
    ft8_lib: 'Parts of the FT8 and FT4 codec are ported from ft8_lib by Kārlis Goba.',
    Lucide: 'The reset arrow in the band sheet is an icon from Lucide.',
    Inter: 'The Inter typeface is the interface font where Apple’s is missing, or when chosen in Appearance.',
  };
</script>

<section class="screen sub" aria-labelledby="credits-title">
  <BackLink to={href('settings')} label="Settings" title="Credits" id="credits-title" />

  {#each list as n (n.name)}
    <div class="section">
      <h2 class="section-head">{n.name}</h2>
      <div class="group">
        {#if USES[n.name]}<p class="row use">{USES[n.name]}</p>{/if}
        <div class="row licence">
          {#each n.paragraphs as p, i (i)}<p>{p}</p>{/each}
        </div>
      </div>
    </div>
  {/each}
</section>

<style>
  .sub {
    padding-top: var(--rr-safe-top);
  }

  .use {
    font-size: var(--rr-text-sub);
    line-height: var(--rr-leading-sub);
  }

  /* The licence word for word, its paragraphs one under another. */
  .licence {
    flex-direction: column;
    gap: var(--rr-space-2);
    align-items: stretch;
    padding-block: var(--rr-space-3);
    color: var(--rr-label2);
    font-size: var(--rr-text-foot);
    line-height: var(--rr-leading-foot);
  }
</style>
