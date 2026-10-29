<script lang="ts">
  /**
   * The practice band's scenarios, opened from Practice scenario in Operate's •••: one row each,
   * the chosen one with a checkmark. A tap chooses it and closes the sheet. LQ8 lists the
   * scenarios its messages have (lib/practice/scenarios.ts).
   */
  import Icon from './Icon.svelte';
  import Sheet from './Sheet.svelte';
  import { scenarioIn, scenariosIn, type ScenarioId } from '../lib/practice/scenarios';
  import { chooseScenario } from '../lib/practice/runtime.svelte';
  import { practice } from '../lib/state/practice.svelte';
  import { settings } from '../lib/state/settings.svelte';

  let { open = $bindable(false) }: { open: boolean } = $props();

  function choose(id: ScenarioId) {
    chooseScenario(id);
    open = false;
  }
</script>

<Sheet bind:open title="Practice scenario">
  <div class="group" role="radiogroup" aria-label="Practice scenario">
    {#each scenariosIn(settings.mode) as s (s.id)}
      {@const on = scenarioIn(practice.scenario, settings.mode) === s.id}
      <button type="button" class="row pick" role="radio" aria-checked={on} onclick={() => choose(s.id)}>
        <span class="row-main"><span class="row-title">{s.name}</span></span>
        <span class="tick" aria-hidden="true">{#if on}<Icon name="check" size={20} />{/if}</span>
      </button>
    {/each}
  </div>
</Sheet>

<style>
  .pick {
    width: 100%;
    text-align: left;
    cursor: pointer;
  }

  .pick:focus-visible {
    box-shadow: inset 0 0 0 2px var(--rr-accent);
  }

  .tick {
    flex: none;
    width: 20px;
    color: var(--rr-accent);
  }
</style>
