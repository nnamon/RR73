import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// The commit a Pages build came from (Actions sets GITHUB_SHA); local builds say "local".
const build = (process.env.GITHUB_SHA ?? '').slice(0, 7) || 'local';

// GitHub Pages serves the app under /RR73/ (the repository name, case-sensitive); local builds use /.
const base = process.env.BASE_PATH ?? '/';

/**
 * Serves the repository's CHANGELOG.md as `virtual:changelog`, read from disk on every load, so
 * dev and build both work while the file lives outside the Vite root (web/).
 */
function changelog(): Plugin {
  const id = 'virtual:changelog';
  const resolved = `\0${id}`;
  const file = fileURLToPath(new URL('../CHANGELOG.md', import.meta.url));
  return {
    name: 'rr73-changelog',
    resolveId: (source) => (source === id ? resolved : null),
    load(source) {
      if (source !== resolved) return null;
      if (existsSync(file)) this.addWatchFile(file);
      const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
      return `export default ${JSON.stringify(text)};`;
    },
  };
}

export default defineConfig({
  base,
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_BUILD__: JSON.stringify(build),
  },
  plugins: [
    svelte(),
    changelog(),
    VitePWA({
      // A new version installs and waits; the app lets it take over at a safe moment and reloads
      // (src/lib/app/update.svelte.ts registers the worker). Taking over at once (autoUpdate)
      // deleted the running build's files from the cache while that build still needed them.
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.ico', 'icon.svg', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'RR73',
        short_name: 'RR73',
        description: 'FT8 and FT4 through the headset jack.',
        // Literal colours: the manifest cannot read CSS. They match --rr-bg in light.
        theme_color: '#F2F2F7',
        background_color: '#F2F2F7',
        display: 'standalone',
        orientation: 'any',
        start_url: base,
        scope: base,
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Reference data (tools/refdata): the country file and the data manifest install with the
        // app. The park and summit lists belong to Activations; the app fetches and keeps them
        // itself only while it is on (src/lib/reference/store.ts).
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest,wasm}', 'data/manifest.json', 'data/cty.json'],
        navigateFallback: `${base}index.html`,
        cleanupOutdatedCaches: true,
        // Wait for SKIP_WAITING from the app. The first install controls the open page at once.
        skipWaiting: false,
        clientsClaim: true,
        // Takes over at once from builds up to 0.5.0, which expect it (public/sw-handover.js).
        importScripts: ['sw-handover.js'],
      },
    }),
  ],
  worker: { format: 'es' },
  server: { host: '0.0.0.0', port: 7374, strictPort: true },
  preview: { host: '0.0.0.0', port: 7374, strictPort: true },
  // iOS 26 is the target, so CSS keeps light-dark() native. Older targets get the minifier's fallback.
  build: { target: 'es2022', cssTarget: ['safari18', 'chrome123'], sourcemap: true },
});
