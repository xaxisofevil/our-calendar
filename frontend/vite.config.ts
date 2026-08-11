import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
// BACKEND_PORT lets an isolated test run (see playwright.config.ts) point
// the dev proxy at its own backend instance instead of the normal :3001
// dev/prod one — defaults to 3001 so plain `npm run dev` is unaffected.
const backendPort = process.env.BACKEND_PORT || '3001'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    allowedHosts: ['.trycloudflare.com'],
    proxy: {
      '/api': {
        target: `http://localhost:${backendPort}`,
        changeOrigin: true,
      },
    },
  },
})
