import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages serves the app from /<repo-name>/. Override with BASE_PATH=/ for other hosts.
const base = process.env.BASE_PATH ?? '/poketmon_card_scan/';

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'CardCheck - 카드 시세 스캐너',
        short_name: 'CardCheck',
        description: '포켓몬 카드를 찍으면 시세를 알려주는 무료 앱',
        theme_color: '#0A1224',
        background_color: '#0A1224',
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
            // Tesseract OCR engine + language data from the CDN.
            urlPattern: /^https:\/\/(cdn\.jsdelivr\.net|tessdata\.projectnaptha\.com)\//,
            handler: 'CacheFirst',
            options: { cacheName: 'ocr-assets', expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 90 } },
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
