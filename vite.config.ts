import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png', 'privacy.html', 'terms.html', 'cb.html'],
      workbox: {
        navigateFallbackDenylist: [/^\/(privacy|terms|cb)\.html$/],
      },
      manifest: {
        name: 'Heimat',
        short_name: 'Heimat',
        description: 'Money & life companion for international students abroad',
        theme_color: '#0c1110',
        background_color: '#0c1110',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
})
