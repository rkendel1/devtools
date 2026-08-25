import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const rootDir = import.meta.dirname

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      'runtime_investigator_wasm': path.resolve(rootDir, 'wasm-engine/pkg'),
    },
  },
  build: {
    rollupOptions: {
      input: {
        panel: path.resolve(rootDir, 'panel.html'),
        devtools: path.resolve(rootDir, 'devtools.html'),
      },
    },
  },
})
