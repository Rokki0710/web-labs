import { resolve } from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  base: '/static/',
  publicDir: false,
  build: {
    manifest: true,
    rollupOptions: {
      input: Object.fromEntries(['main.ts', 'auth.ts', 'profile.ts', 'movies.ts', 'movie.ts', 'styles.css']
        .map(file => [file, resolve(import.meta.dirname, 'src', file)])),
    },
  },
})
