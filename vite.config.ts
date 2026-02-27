import { defineConfig } from 'vite';
import path from 'node:path';
import fs from 'node:fs';

/** Emit the AudioWorklet chunk as .js so GitHub Pages serves it with correct MIME type */
function workletJsPlugin() {
  return {
    name: 'worklet-js',
    apply: 'build',
    generateBundle(_, bundle) {
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue;
        const chunk = output as { fileName: string; code: string };
        if (!chunk.fileName?.includes('engine-worklet') || !chunk.fileName.endsWith('.ts')) continue;
        const oldName = chunk.fileName;
        const newFileName = oldName.replace(/\.ts$/, '.js');
        chunk.fileName = newFileName;
        for (const other of Object.values(bundle)) {
          if (other.type === 'chunk' && (other as { code?: string }).code) {
            (other as { code: string }).code = (other as { code: string }).code.replace(
              oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
              newFileName,
            );
          }
        }
        break;
      }
    },
    writeBundle(options) {
      const outDir = (options as { dir?: string }).dir ?? 'dist';
      const assetsDir = path.join(outDir, 'assets');
      if (!fs.existsSync(assetsDir)) return;
      const files = fs.readdirSync(assetsDir);
      const workletTs = files.find((f) => f.startsWith('engine-worklet-') && f.endsWith('.ts'));
      if (!workletTs) return;
      const workletJs = workletTs.replace(/\.ts$/, '.js');
      const fullOld = path.join(assetsDir, workletTs);
      const fullNew = path.join(assetsDir, workletJs);
      fs.renameSync(fullOld, fullNew);
      const mainJs = files.find((n) => n.startsWith('index-') && n.endsWith('.js'));
      if (mainJs) {
        const mainPath = path.join(assetsDir, mainJs);
        let code = fs.readFileSync(mainPath, 'utf8');
        if (code.includes(workletTs)) {
          code = code.split(workletTs).join(workletJs);
          fs.writeFileSync(mainPath, code);
        }
      }
    },
  };
}

export default defineConfig({
  root: '.',
  // GitHub Pages: set BASE_URL in workflow to e.g. /engineSimulator/
  base: process.env.BASE_URL || './',
  server: {
    host: true,
  },
  plugins: [workletJsPlugin()],
  build: {
    target: 'esnext',
    outDir: 'dist',
    rollupOptions: {
      output: {
        chunkFileNames: 'assets/[name]-[hash].js',
      },
    },
  },
});
