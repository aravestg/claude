import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/src/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      exclude: ['**/cli.ts', '**/index.ts', 'packages/visualization-3d/src/*.tsx', 'packages/visualization-3d/src/geometry.ts'],
      reporter: ['text', 'lcov', 'json-summary'],
      thresholds: { lines: 80, functions: 80, branches: 70, statements: 80 }
    }
  }
});
