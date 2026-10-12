import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  // Component tests mount Svelte in jsdom, which needs the browser build of Svelte.
  resolve: { conditions: ['browser'] },
  define: { __APP_VERSION__: JSON.stringify('0.1.0'), __APP_BUILD__: JSON.stringify('test') },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
    setupFiles: ['src/test-setup.ts'],
  },
});
