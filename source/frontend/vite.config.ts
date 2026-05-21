import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import { VitePWA } from 'vite-plugin-pwa'

const FRONTEND_PORT = Number(process.env.FRONTEND_PORT ?? 8000)
const BACKEND_DEV_PORT = Number(process.env.BACKEND_DEV_PORT ?? 8001)

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  plugins: [
    TanStackRouterVite({
      routesDirectory: './src/routes',
      generatedRouteTree: './src/routeTree.gen.ts',
      autoCodeSplitting: true,
      routeFileIgnorePattern: '(^|/)__tests__/|\\.test\\.',
    }),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Finanzguru Clone',
        short_name: 'Finanzguru',
        description: 'Personal finance overview',
        theme_color: '#0a0a0a',
        background_color: '#0a0a0a',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/pwa-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api/],
      },
    }),
  ],
  server: {
    // Bind to 0.0.0.0 so the dev server is reachable from other devices on the
    // LAN (phone, tablet) for PWA testing. The backend still only listens on
    // 127.0.0.1; LAN clients reach it through this server's /api proxy.
    host: true,
    port: FRONTEND_PORT,
    strictPort: true,
    proxy: {
      '/api': {
        target: `http://localhost:${BACKEND_DEV_PORT}`,
        changeOrigin: false,
      },
      // Bank icons + any other backend-served static assets. Without this,
      // Vite's SPA fallback would return index.html for /static/banks/*.png.
      '/static': {
        target: `http://localhost:${BACKEND_DEV_PORT}`,
        changeOrigin: false,
      },
    },
  },
})
