import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// The commit a Pages build came from (Actions sets GITHUB_SHA); local builds say "local".
const build = (process.env.GITHUB_SHA ?? '').slice(0, 7) || 'local';

// GitHub Pages serves the app under /RR73/ (the repository name, case-sensitive); local builds use /.
const base = process.env.BASE_PATH ?? '/';

/**
 * Serves a file of the repository as the module `id`, its text the default export, read from disk
 * on every load, so dev and build both work while the file lives outside the Vite root (web/):
 * CHANGELOG.md for Version history, THIRD_PARTY_NOTICES.md for Credits.
 */
function repoText(id: string, path: string): Plugin {
  const resolved = `\0${id}`;
  const file = fileURLToPath(new URL(`../${path}`, import.meta.url));
  return {
    name: `rr73-${id.replace('virtual:', '')}`,
    resolveId: (source) => (source === id ? resolved : null),
    load(source) {
      if (source !== resolved) return null;
      if (existsSync(file)) this.addWatchFile(file);
      const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
      return `export default ${JSON.stringify(text)};`;
    },
  };
}

/**
 * Serves the Markdown files of a repository directory as the module `id`: an object from each
 * file's name without `.md` to its text, read on every load. docs/guide becomes the Guide in
 * Settings, bundled so it reads offline. The images in its img/ directory are the named export
 * `images`, from "img/name.webp" to the URL of the bundled file, so the precache holds them.
 */
function repoDir(id: string, path: string): Plugin {
  const resolved = `\0${id}`;
  const dir = fileURLToPath(new URL(`../${path}`, import.meta.url));
  return {
    name: `rr73-${id.replace('virtual:', '')}`,
    resolveId: (source) => (source === id ? resolved : null),
    load(source) {
      if (source !== resolved) return null;
      const pages: Record<string, string> = {};
      const images: string[] = [];
      const imgDir = `${dir}/img`;
      if (existsSync(imgDir)) {
        this.addWatchFile(imgDir);
        images.push(...readdirSync(imgDir).filter((n) => n.endsWith('.webp')).sort());
      }
      if (existsSync(dir)) {
        this.addWatchFile(dir);
        for (const name of readdirSync(dir).filter((n) => n.endsWith('.md')).sort()) {
          const file = `${dir}/${name}`;
          this.addWatchFile(file);
          pages[name.slice(0, -3)] = readFileSync(file, 'utf8');
        }
      }
      const imports = images.map((n, i) => `import i${i} from ${JSON.stringify(`${imgDir}/${n}`)};`).join('\n');
      const map = images.map((n, i) => `${JSON.stringify(`img/${n}`)}: i${i}`).join(', ');
      return `${imports}\nexport const images = {${map}};\nexport default ${JSON.stringify(pages)};`;
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
    repoText('virtual:changelog', 'CHANGELOG.md'),
    repoText('virtual:notices', 'THIRD_PARTY_NOTICES.md'),
    repoDir('virtual:guide', 'docs/guide'),
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
        description: 'FT8, FT4, WSPR and RTTY on an iPhone through a headset-jack or USB interface, or on a computer with rig control.',
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
        globPatterns: ['**/*.{js,css,html,svg,png,webp,ico,webmanifest,wasm}', 'data/manifest.json', 'data/cty.json'],
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
  // The dev server reads the guide's images from docs/guide, outside web/.
  server: { host: '0.0.0.0', port: 7374, strictPort: true, fs: { allow: ['..'] } },
  preview: { host: '0.0.0.0', port: 7374, strictPort: true },
  // iOS 26 is the target, so CSS keeps light-dark() native. Older targets get the minifier's fallback.
  build: { target: 'es2022', cssTarget: ['safari18', 'chrome123'], sourcemap: true },
});
