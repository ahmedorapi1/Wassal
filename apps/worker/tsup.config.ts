import { defineConfig } from 'tsup';

export default defineConfig({
  clean: true,
  entry: ['src/main.ts'],
  external: ['pino'],
  format: ['esm'],
  noExternal: [/^@wasel\//],
  platform: 'node',
  skipNodeModulesBundle: true,
  sourcemap: true,
  target: 'node24',
});
