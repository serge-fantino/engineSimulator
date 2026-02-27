import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  // GitHub Pages: set BASE_URL in workflow to e.g. /engineSimulator/
  base: process.env.BASE_URL || './',
  server: {
    host: true,
  },
  build: {
    target: 'esnext',
    outDir: 'dist',
  },
});
