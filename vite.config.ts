import { resolve } from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        movies: resolve(import.meta.dirname, 'movies.html'),
        about: resolve(import.meta.dirname, 'about.html'),
      },
    },
  },
})
