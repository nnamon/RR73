// Every upload starts off: reports to PSK Reporter, Heard you (PSK Reporter's feed) and uploads
// to WSPRnet. Each turns on only from its switch, and a stored value that is not true or false
// reads as off.
import { describe, expect, it } from 'vitest';
import { mergeKv } from './db';
import { loadPskReporter, pskReporter } from './pskreporter.svelte';
import { heardYou, loadHeardYou } from './heard.svelte';
import { loadWsprnet, wsprnet } from './wsprnet.svelte';
import { loadRelay, relay } from './relay.svelte';

describe('uploads', () => {
  it('are off on a new install, web SDR receive included', async () => {
    await Promise.all([loadPskReporter(), loadHeardYou(), loadWsprnet(), loadRelay()]);
    expect([pskReporter.on, heardYou.on, wsprnet.on, relay.sdrOn]).toEqual([false, false, false, false]);
  });

  it('stay off when what is stored is not true or false', async () => {
    await mergeKv('pskreporter', { on: 'yes' });
    await mergeKv('heardyou', { on: 1 });
    await mergeKv('wsprnet', { on: null });
    await Promise.all([loadPskReporter(), loadHeardYou(), loadWsprnet()]);
    expect([pskReporter.on, heardYou.on, wsprnet.on]).toEqual([false, false, false]);
  });
});
