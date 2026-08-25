import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        panel: path.resolve(__dirname, 'panel.html'),
        devtools: path.resolve(__dirname, 'devtools.html'),
      },
    },
  },
})
