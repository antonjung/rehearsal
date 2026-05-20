import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { readFileSync } from 'fs'

const { version } = JSON.parse(readFileSync('./package.json', 'utf-8'))

export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/rehearsal/' : '/',
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  plugins: [
    tailwindcss(),
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['cueline.png'],
      manifest: {
        name: 'CueLine',
        short_name: 'CueLine',
        description: 'Learn your lines for a play',
        theme_color: '#1e1b4b',
        background_color: '#0f0e17',
        display: 'standalone',
        icons: [
          { src: 'cueline.png', sizes: '412x382', type: 'image/png' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,mjs,css,html,ico,png,svg,json,txt}'],
        clientsClaim: true,
        skipWaiting: true,
      },
    }),
  ],
}))
