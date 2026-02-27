import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  server: {
    host: true,
  },
  build: {
    target: 'esnext',
    outDir: 'dist',
  },
});
