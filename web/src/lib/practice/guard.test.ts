// The network guard: while practice is on, only the app's own files go out.
import { describe, expect, it, vi } from 'vitest';
import { BLOCKED_MESSAGE, allowedInPractice, guardFetch, type Fetch } from './guard';

const ORIGIN = 'https://amon.github.io';

function setup(on: boolean) {
  const inner = vi.fn<Fetch>(async () => new Response('ok'));
  const state = { on };
  return { inner, state, fetch: guardFetch(inner, () => state.on, ORIGIN) };
}

describe('the network guard', () => {
  it('lets the app load its own files while practice is on', async () => {
    const g = setup(true);
    for (const url of ['/RR73/index.html', `${ORIGIN}/RR73/assets/rr73_wasm_bg.wasm`, './CHANGELOG.md']) await expect(g.fetch(url)).resolves.toBeInstanceOf(Response);
    await expect(g.fetch(`${ORIGIN}/RR73/index.html`, { method: 'HEAD' })).resolves.toBeInstanceOf(Response);
    expect(g.inner).toHaveBeenCalledTimes(4);
  });

  it('refuses every other request while practice is on, whatever form it takes', async () => {
    const g = setup(true);
    const attempts: [RequestInfo | URL, RequestInit?][] = [
      ['https://log.example.com/api/qso', { method: 'POST', body: '{}' }],
      ['https://api.pota.app/spot/activator'],
      [new URL('https://www.hamqth.com/dxc_csv.php')],
      [new Request('https://lotw.arrl.org/lotw-user-activity.csv')],
      ['/RR73/report', { method: 'POST' }],
      [new Request(`${ORIGIN}/RR73/report`, { method: 'PUT' })],
      ['//other.example/x'],
    ];
    for (const [input, init] of attempts) await expect(g.fetch(input, init)).rejects.toThrow(BLOCKED_MESSAGE);
    expect(g.inner).not.toHaveBeenCalled();
  });

  it('passes everything through while practice is off, and follows the switch', async () => {
    const g = setup(false);
    await g.fetch('https://log.example.com/api/qso', { method: 'POST' });
    expect(g.inner).toHaveBeenCalledTimes(1);
    g.state.on = true;
    await expect(g.fetch('https://log.example.com/api/qso', { method: 'POST' })).rejects.toThrow(TypeError);
    g.state.on = false;
    await g.fetch('https://log.example.com/api/qso', { method: 'POST' });
    expect(g.inner).toHaveBeenCalledTimes(2);
  });

  it('reads a URL against the page origin', () => {
    expect(allowedInPractice('/sw.js', 'GET', ORIGIN)).toBe(true);
    expect(allowedInPractice(`${ORIGIN}:8443/x`, 'GET', ORIGIN)).toBe(false);
    expect(allowedInPractice('http://amon.github.io/x', 'GET', ORIGIN)).toBe(false);
    expect(allowedInPractice('/x', 'POST', ORIGIN)).toBe(false);
  });
});
