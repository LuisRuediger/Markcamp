import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vitest/config'
import { previewAllowedHosts } from './previewHost.ts'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
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
  preview: {
    // Opened from a phone through Tailscale Serve. preview.proxy is not set: Vite falls
    // back to server.proxy.
    // Pinned to 127.0.0.1:4173, the address tailscale serve forwards to ('localhost' can
    // resolve to ::1 on macOS). strictPort fails instead of moving to another port:
    // whatever listens on 4173 is published to the tailnet at MarkCamp's origin.
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
    // The tailnet host name, accepted in the Host header.
    allowedHosts: previewAllowedHosts(previewHostVariable(mode)),
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['src/ui/test-setup.ts'],
  },
}))

// MARKCAMP_ (not VITE_) on purpose: only VITE_ variables can reach the bundle.
// The config file's own directory (not process.cwd()), so running Vite from another
// folder still reads frontend/.env.local.
function previewHostVariable(mode: string): string | undefined {
  return loadEnv(mode, import.meta.dirname, 'MARKCAMP_')['MARKCAMP_PREVIEW_HOST']
}
