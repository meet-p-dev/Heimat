import { defineConfig } from 'vite'
import { resolve } from 'node:path'
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
  build: {
    rollupOptions: {
      // reset.html is a second entry, not a public/ asset: it needs the Supabase
      // URL and key compiled in the same way the app does. The emailed
      // password-reset link points at it.
      input: {
        main: resolve(__dirname, 'index.html'),
        reset: resolve(__dirname, 'reset.html'),
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      disable: native,
      registerType: 'autoUpdate',
      // registered by hand from main.tsx instead of auto-injected into every
      // HTML entry: reset.html is a one-shot page opened from an email, and an
      // autoUpdate service worker taking control there would reload it out from
      // under whoever is mid-way through typing a new password.
      injectRegister: null,
      includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png', 'privacy.html', 'terms.html', 'cb.html', 'legal/privacy.html', 'legal/terms.html'],
      workbox: {
        // reset.html has to load from the network exactly as the email links to
        // it — never rewritten to the app shell, which would swallow the
        // recovery token in the fragment. cb.html is the same story: it is now
        // only a forwarder to MoneyTrack's own callback, and it forwards the
        // consent code that arrives in the query string.
        navigateFallbackDenylist: [/(privacy|terms|cb|reset)\.html$/],
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
