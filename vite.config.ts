import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages serves the app from /<repo-name>/. CI passes the real Pages path as BASE_PATH (so a renamed repo or a
// custom domain still works); use BASE_PATH=/ for hosts that serve from the root (Cloudflare Pages, Netlify).
// Unset or empty → the default. Slashes are normalised: "poketmon_card_scan" and "/x//" become "/poketmon_card_scan/", "/x/".
function normalizeBase(raw: string | undefined): string {
  const value = (raw ?? '').trim() || '/poketmon_card_scan/';
  if (/^https?:\/\//i.test(value)) return value.endsWith('/') ? value : `${value}/`;
  return `/${value}/`.replace(/\/{2,}/g, '/');
}
const base = normalizeBase(process.env.BASE_PATH);

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      // 'prompt': a new deploy waits instead of reloading the page while a kid is using it. src/main.tsx applies it
      // when the app is hidden (or it activates by itself on the next cold launch).
      registerType: 'prompt',
      manifest: {
        name: 'CardCheck - 카드 시세 스캐너',
        short_name: 'CardCheck',
        description: '포켓몬 카드를 찍으면 시세를 알려주는 무료 앱',
        lang: 'ko',
        theme_color: '#0A1020',
        background_color: '#0A1020',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Take control on the very first visit, so that session's OCR engine and card images go into the caches.
        // Updates still wait for src/main.tsx: skipWaiting stays off.
        clientsClaim: true,
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        runtimeCaching: [
          {
            // Card images rarely change: cache-first.
            urlPattern: /^https:\/\/assets\.tcgdex\.net\//,
            handler: 'CacheFirst',
            options: { cacheName: 'card-images', expiration: { maxEntries: 600, maxAgeSeconds: 60 * 60 * 24 * 30 } },
          },
          {
            // Card data & prices: try network first so prices stay fresh, fall back to cache offline.
            urlPattern: /^https:\/\/api\.tcgdex\.net\//,
            handler: 'NetworkFirst',
            options: { cacheName: 'card-data', networkTimeoutSeconds: 8, expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 7 } },
          },
          {
            // Tesseract OCR engine + language data (versioned URLs). The worker loads the engine with
            // importScripts, which gives opaque responses: allow status 0 or scanning would need the network.
            urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/npm\/(tesseract\.js(-core)?@|@tesseract\.js-data\/)/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'ocr-assets',
              cacheableResponse: { statuses: [0, 200] },
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 90 },
            },
          },
          {
            // Pretendard stylesheet + its ~90 unicode-range subsets; kept apart so fonts never evict the OCR engine.
            urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/npm\/pretendard@/,
            handler: 'CacheFirst',
            options: { cacheName: 'fonts', expiration: { maxEntries: 120, maxAgeSeconds: 60 * 60 * 24 * 365 } },
          },
        ],
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
