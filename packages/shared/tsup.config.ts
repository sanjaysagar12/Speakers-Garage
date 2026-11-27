import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts', schemas: 'src/net/schemas.ts' },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  treeshake: true,
});
