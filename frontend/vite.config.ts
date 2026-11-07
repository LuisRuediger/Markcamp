import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // 'prompt' generates a service worker without skipWaiting/clientsClaim: a new
      // version waits until every window of the app is closed. Nothing reloads a page.
      registerType: 'prompt',
      // A plain registerSW.js with no update handling. The in-app "nova versão
      // disponível" prompt comes in a later slice, through virtual:pwa-register.
      injectRegister: 'script',
      manifest: {
        name: 'MarkCamp',
        short_name: 'MarkCamp',
        lang: 'pt-BR',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        theme_color: '#2e7d32',
        background_color: '#ffffff',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      workbox: {
        // App shell only: the default js/css/html glob plus the manifest and its icons.
        // No runtimeCaching on purpose: API responses are never cached.
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  server: {
    proxy: {
      // The browser sees a single origin, so the backend needs no CORS configuration.
      '/api': 'http://localhost:8080',
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['src/ui/test-setup.ts'],
  },
})
