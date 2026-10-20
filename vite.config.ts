import { defineConfig } from 'vite'

// Relative base: the site works at any path (GitHub Pages serves it under /<repo>/).
export default defineConfig({
  base: './',
  build: { assetsInlineLimit: 0, chunkSizeWarningLimit: 800 }, // three.js is the lazy oaPipeline chunk
})
