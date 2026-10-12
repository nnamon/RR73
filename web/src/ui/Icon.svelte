<script lang="ts">
  import { ICONS, type IconName, type IconShape } from './icons';

  let { name, size = 24, class: cls = '' }: { name: IconName; size?: number; class?: string } = $props();
  const shape: IconShape = $derived(ICONS[name]);
</script>

<svg class="icon {cls}" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
  <g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width={shape.width ?? 2}>
    {#each shape.stroke ?? [] as d, i (i)}<path {d} />{/each}
    {#each shape.rings ?? [] as [cx, cy, rx, ry], i (i)}<ellipse {cx} {cy} {rx} {ry} />{/each}
  </g>
  {#each shape.fill ?? [] as d, i (i)}<path {d} fill="currentColor" />{/each}
  {#each shape.dots ?? [] as [cx, cy, r], i (i)}<circle {cx} {cy} {r} fill="currentColor" />{/each}
</svg>

<style>
  .icon {
    display: block;
    flex: none;
    overflow: visible;
  }
</style>
