import { defineConfig } from 'tsup';

// One self-contained ESM file for the Docker image; npm dependencies stay external, the workspace
// package (@shoreline/shared) is bundled in so the image doesn't need the monorepo.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  clean: true,
  noExternal: [/^@shoreline\/shared/],
});
