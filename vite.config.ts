import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  base: './', // relative base so the app works on GitHub Pages (e.g. user.github.io/repo-name/)
  server: {
    host: true,
  },
  build: {
    target: 'esnext',
    outDir: 'dist',
  },
});
