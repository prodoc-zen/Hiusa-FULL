import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// scripts/serve-lan.ps1 -Public serves the built client with `vite preview`
// behind a Cloudflare quick tunnel and sets HIUSA_PUBLIC=1. The preview server
// then sends the API and its uploaded files to the local Laravel server (same
// origin for the browser) and accepts the tunnel host name. Without the
// variable none of this applies.
const publicDemo = process.env.HIUSA_PUBLIC === '1'
const apiTarget = process.env.HIUSA_API_TARGET || 'http://127.0.0.1:8000'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
  },
  preview: publicDemo
    ? {
        allowedHosts: ['.trycloudflare.com'],
        proxy: {
          '/api': apiTarget,
          '/storage': apiTarget,
          '/uploads': apiTarget,
        },
      }
    : {},
})
