import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@tussel/audio': path.resolve('packages/audio/src/index.ts'),
      '@tussel/cli': path.resolve('packages/cli/src/index.ts'),
      '@tussel/core': path.resolve('packages/core/src/index.ts'),
      '@tussel/dsl': path.resolve('packages/dsl/src/index.ts'),
      '@tussel/ir': path.resolve('packages/ir/src/index.ts'),
      '@tussel/mini': path.resolve('packages/mini/src/index.ts'),
      '@tussel/parity': path.resolve('packages/parity/src/index.ts'),
      '@tussel/runtime': path.resolve('packages/runtime/src/index.ts'),
      '@tussel/testkit': path.resolve('packages/testkit/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['packages/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      exclude: [
        'packages/*/src/**/*.test.ts',
        'packages/cli/src/user-audio-test.ts',
        'packages/parity/src/user-listen-test.ts',
        'packages/parity/src/cli.ts',
      ],
      reporter: ['text', 'text-summary', 'lcov'],
      reportsDirectory: './coverage',
      thresholds: {
        statements: 60,
        branches: 50,
        functions: 50,
        lines: 60,
      },
    },
  },
});
