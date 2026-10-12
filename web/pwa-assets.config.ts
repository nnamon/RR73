import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

// Regenerates the icons in public/ from public/icon.svg. Run in the node container:
//   docker compose run --rm node npm --prefix web run icons
// The background matches --rr-accent-fill in the light theme.
export default defineConfig({
  preset: {
    ...minimal2023Preset,
    maskable: { ...minimal2023Preset.maskable, resizeOptions: { background: '#2851D8' }, padding: 0.3 },
    apple: { ...minimal2023Preset.apple, resizeOptions: { background: '#2851D8' }, padding: 0.3 },
  },
  images: ['public/icon.svg'],
});
