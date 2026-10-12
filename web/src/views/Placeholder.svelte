<script lang="ts">
  /** A tab whose feature arrives in a later version: its title and what will appear there. */
  let { title, heading, text }: { title: string; heading: string; text: string } = $props();
</script>

<section class="screen" aria-labelledby="placeholder-title">
  <h1 id="placeholder-title" class="large-title">{title}</h1>
  <div class="empty">
    <h2>{heading}</h2>
    <p>{text}</p>
  </div>
</section>
