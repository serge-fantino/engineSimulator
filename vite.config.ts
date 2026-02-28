import { defineConfig } from 'vite';
import path from 'node:path';
import fs from 'node:fs';
import * as esbuild from 'esbuild';

/**
 * Transpile the AudioWorklet chunk (Rollup may emit it without TS transform) and emit as .js.
 */
function workletTranspilePlugin() {
  return {
    name: 'worklet-transpile',
    apply: 'build',
    generateBundle(_, bundle) {
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue;
        const chunk = output as { fileName: string; code: string };
        // Worklet chunk: id might not contain 'engine-worklet' in fileName yet; match by content
        const isWorklet = chunk.fileName?.includes('engine-worklet') || chunk.code?.includes("registerProcessor('engine-worklet'");
        if (!isWorklet) continue;

        // Transpile worklet chunk (Rollup can emit it without going through TS transform)
        const result = esbuild.transformSync(chunk.code, {
          loader: 'ts',
          target: 'esnext',
          format: 'esm',
        });
        if (result.code) chunk.code = result.code;

        const oldName = chunk.fileName;
        const newFileName = oldName.replace(/\.ts$/, '.js');
        if (newFileName !== oldName) {
          chunk.fileName = newFileName;
          for (const other of Object.values(bundle)) {
            if (other.type === 'chunk' && (other as { code?: string }).code) {
              (other as { code: string }).code = (other as { code: string }).code.replace(
                oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
                newFileName,
              );
            }
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
      const workletPath = path.join(assetsDir, workletTs);
      let code = fs.readFileSync(workletPath, 'utf8');
      // Transpile if Rollup emitted raw TypeScript
      if (/interface\s|\bprivate\s/.test(code)) {
        const result = esbuild.transformSync(code, { loader: 'ts', target: 'esnext', format: 'esm' });
        if (result.code) code = result.code;
      }
      const workletJs = workletTs.replace(/\.ts$/, '.js');
      fs.writeFileSync(path.join(assetsDir, workletJs), code);
      fs.unlinkSync(workletPath);
      const mainJs = files.find((n) => n.startsWith('index-') && n.endsWith('.js'));
      if (mainJs) {
        const mainPath = path.join(assetsDir, mainJs);
        let mainCode = fs.readFileSync(mainPath, 'utf8');
        if (mainCode.includes(workletTs)) {
          fs.writeFileSync(mainPath, mainCode.split(workletTs).join(workletJs));
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
  plugins: [workletTranspilePlugin()],
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
