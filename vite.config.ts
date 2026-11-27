import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';

/** Writes .gz and .br next to every emitted text asset, for servers that serve precompressed files. */
function precompress(): Plugin {
  let outDir = 'dist';
  return {
    name: 'precompress',
    apply: 'build',
    configResolved(c) {
      outDir = c.build.outDir;
    },
    writeBundle(_opts, bundle) {
      for (const file of Object.keys(bundle)) {
        if (!/\.(js|css|html|json|svg)$/.test(file)) continue;
        const p = path.join(outDir, file);
        const buf = fs.readFileSync(p);
        if (buf.length < 1024) continue;
        fs.writeFileSync(`${p}.gz`, zlib.gzipSync(buf, { level: 9 }));
        fs.writeFileSync(`${p}.br`, zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }));
      }
    },
  };
}

/**
 * Long-lived vendor chunks: they change rarely, so repeat visits hit the cache. Rolldown's native groups;
 * dependencies are NOT pulled in recursively, otherwise the r3f group swallows react-dom and three and
 * the landing page (which needs only react) would download all of them.
 */
const vendorGroups = {
  includeDependenciesRecursively: false,
  groups: [
    { name: 'vendor-react', test: /node_modules[\\/](react|react-dom|scheduler|zustand|use-sync-external-store)[\\/]/ },
    { name: 'vendor-three', test: /node_modules[\\/]three[\\/]/ },
    { name: 'vendor-r3f', test: /node_modules[\\/](@react-three|postprocessing|its-fine|suspend-react|react-reconciler|react-use-measure|three-stdlib|easystarjs|zustand\/vanilla)[\\/]/ },
  ],
};

export default defineConfig({
  // ANALYZE=1 npm run build -> dist/stats.html (bundle treemap)
  plugins: [react(), precompress(), ...(process.env.ANALYZE ? [visualizer({ filename: 'dist/stats.html', gzipSize: true, brotliSize: true })] : [])],
  build: {
    target: 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 800,
    rolldownOptions: { output: { codeSplitting: vendorGroups } },
  },
  server: { host: true },
});
