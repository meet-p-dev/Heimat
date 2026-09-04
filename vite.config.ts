import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// VITE_NATIVE=1 builds the bundle that goes inside the iOS/Android shells.
// There the app is served from the app bundle itself, so the PWA service
// worker is pure overhead (and unavailable on iOS's capacitor:// scheme).
const native = process.env.VITE_NATIVE === '1'

// base defaults to '/' (local dev, root hosting, and both native shells). For
// GitHub Pages project sites the deploy workflow sets VITE_BASE=/Heimat/ so
// assets resolve under the subpath.
export default defineConfig({
  base: native ? '/' : process.env.VITE_BASE || '/',
  plugins: [
    react(),
    VitePWA({
      disable: native,
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png', 'privacy.html', 'terms.html', 'cb.html', 'legal/privacy.html', 'legal/terms.html'],
      workbox: {
        navigateFallbackDenylist: [/(privacy|terms|cb)\.html$/],
        // generateSW writes sw.js for us, so the push/notificationclick handlers
        // live in public/push-sw.js and get pulled into it here
        importScripts: ['push-sw.js'],
      },
      manifest: {
        name: 'Heimat',
        short_name: 'Heimat',
        description: 'Money & life companion for international students abroad',
        theme_color: '#0c1110',
        background_color: '#0c1110',
        display: 'standalone',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
})
