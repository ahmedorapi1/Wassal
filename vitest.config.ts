import { defineConfig } from 'vitest/config';

export default defineConfig({
  oxc: false,
  esbuild: {
    jsx: 'automatic',
    tsconfigRaw: {
      compilerOptions: {
        jsx: 'react-jsx',
      },
    },
  },
  test: {
    // Integration suites share the local PostGIS/Redis stack and mutate seeded
    // review/order records. Run files serially so one Nest lifecycle cannot
    // close or reset shared resources underneath another suite.
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
    },
    include: [
      'packages/**/*.test.ts',
      'apps/**/*.test.ts',
      'apps/**/*.test.tsx',
    ],
    passWithNoTests: false,
  },
});
