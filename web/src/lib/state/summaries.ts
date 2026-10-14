/**
 * The values Settings shows beside its rows and sections: what the audio runs at and where QSOs
 * go. They read reactive state, so they belong inside a $derived.
 */
import { log } from '../log/log.svelte';
import { features } from './features.svelte';
import { audio } from './station.svelte';

/** "48 kHz, mono", or Audio off. */
export function radioSummary(): string {
  const r = audio.report;
  if (audio.status !== 'running' || !r) return 'Audio off';
  const ch = r.channelUsed === 'mono' || !r.channelUsed ? 'mono' : `${r.channelUsed} channel`;
  return `${(r.contextRate / 1000).toFixed(r.contextRate % 1000 ? 1 : 0)} kHz, ${ch}`;
}

/** The destinations on: "Wavelog", "Wavelog and POTA file", "3 destinations", or Only on this phone. */
export function loggingSummary(): string {
  // Activation files count only while Activations is on.
  const on = log.facts.filter((f) => f.active && (features.activations || f.transport !== 'file')).map((f) => f.name);
  if (!on.length) return 'Only on this phone';
  return on.length > 2 ? `${on.length} destinations` : on.join(' and ');
}
