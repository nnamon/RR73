import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

// Regenerates the icons in public/ from public/icon.svg. Run in the node container:
//   docker compose run --rm node npm --prefix web run icons
// icon.svg is full bleed with its own margins (tools/icon/build-icon.mjs), so the maskable and
// Apple icons need no extra padding; the fill matches the icon's background.
export default defineConfig({
  preset: {
    ...minimal2023Preset,
    maskable: { ...minimal2023Preset.maskable, resizeOptions: { background: '#0E1424' }, padding: 0 },
    apple: { ...minimal2023Preset.apple, resizeOptions: { background: '#0E1424' }, padding: 0 },
  },
  images: ['public/icon.svg'],
});
