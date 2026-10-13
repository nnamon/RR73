// Builds the SpotList demo page (index.html, demo.ts) with Vite in memory, once per worker, and
// serves it to the page from a host that exists only inside the test. The app's build, router and
// screens are not involved: SpotList is not wired into the Spots screen yet.
import type { Page } from '@playwright/test';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const WEB = fileURLToPath(new URL('../..', import.meta.url));
const ORIGIN = 'http://spot-list.test';

interface File {
  body: string | Uint8Array;
  type: string;
}

interface BuiltFile {
  fileName: string;
  type: 'chunk' | 'asset';
  code?: string;
  source?: string | Uint8Array;
}

const TYPES: Record<string, string> = { html: 'text/html', js: 'text/javascript', css: 'text/css', json: 'application/json' };

let built: Promise<Map<string, File>> | null = null;

function demo(): Promise<Map<string, File>> {
  built ??= (async () => {
    const result = await build({
      configFile: false,
      root: WEB,
      base: '/',
      logLevel: 'error',
      plugins: [svelte()],
      // As vite.config.ts: iOS 26 is the target, so CSS keeps light-dark() native.
      build: {
        write: false,
        target: 'es2022',
        cssTarget: ['safari18', 'chrome123'],
        minify: false,
        sourcemap: false,
        rolldownOptions: { input: fileURLToPath(new URL('./index.html', import.meta.url)) },
      },
    });
    const outputs = (Array.isArray(result) ? result : [result]) as unknown as { output: BuiltFile[] }[];
    const files = new Map<string, File>();
    for (const o of outputs) {
      for (const f of o.output) {
        const ext = f.fileName.split('.').pop() ?? '';
        files.set(f.fileName, { body: f.type === 'chunk' ? (f.code ?? '') : (f.source ?? ''), type: TYPES[ext] ?? 'application/octet-stream' });
      }
    }
    return files;
  })();
  return built;
}

/** Opens the demo in a state (see demo.ts) and theme. */
export async function openSpotList(page: Page, state: string, theme: 'light' | 'dark') {
  const files = await demo();
  await page.route(`${ORIGIN}/**`, async (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname.slice(1));
    const f = files.get(path);
    if (!f) return route.fulfill({ status: 404, body: `Not in the demo build: ${path}` });
    return route.fulfill({ status: 200, contentType: f.type, body: typeof f.body === 'string' ? f.body : Buffer.from(f.body) });
  });
  await page.emulateMedia({ colorScheme: theme });
  await page.goto(`${ORIGIN}/e2e/spot-list/index.html?state=${state}`);
  await page.locator('body[data-ready="true"]').waitFor({ state: 'attached' });
}

/** Every state demo.ts knows. */
export const STATES = ['list', 'open', 'all', 'long', 'empty', 'offline', 'loading', 'error', 'off', 'pota'] as const;
