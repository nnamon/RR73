<script lang="ts">
  /**
   * The top of every tab root, laid out as iOS does: a 44 pt navigation bar row, always present
   * and empty when the screen has no bar buttons, then the large title (34 pt bold, 16 pt in from
   * the edge). So the large titles of Log, Spots and Settings sit at the same place, and below a
   * sub-screen's 44 pt BackLink bar the content starts at the same height.
   *
   * Bar buttons go in `trailing`, as `.bar-button`s (base.css).
   */
  import type { Snippet } from 'svelte';

  let { title, id, trailing }: { title: string; id: string; trailing?: Snippet } = $props();
</script>

<div class="navbar" data-testid="navbar">
  {#if trailing}<div class="bar-buttons">{@render trailing()}</div>{/if}
</div>
<h1 {id} class="large-title">{title}</h1>

<style>
  .navbar {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    height: var(--rr-tap);
  }
</style>
