import { resolve } from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:3000',
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        movies: resolve(import.meta.dirname, 'movies.html'),
        movie: resolve(import.meta.dirname, 'movie.html'),
        about: resolve(import.meta.dirname, 'about.html'),
        auth: resolve(import.meta.dirname, 'auth.html'),
        profile: resolve(import.meta.dirname, 'profile.html'),
      },
    },
  },
})
