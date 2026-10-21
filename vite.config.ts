import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('/node_modules/')) return

          if (/\/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react-vendor'
          if (id.includes('/node_modules/lucide-react/')) return 'icons'
          if (id.includes('/node_modules/@supabase/')) return 'supabase'
          if (/\/node_modules\/(react-router|@remix-run)\//.test(id)) return 'router'
          if (id.includes('/node_modules/qrcode/')) return 'qrcode'
          if (id.includes('/node_modules/@marsidev/')) return 'turnstile'

          return 'vendor'
        },
      },
    },
  },
})
