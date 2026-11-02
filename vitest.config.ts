import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['**/dist/**', '**/coverage/**', '**/node_modules/**', 'apps/**'],
    },
    workspace: [
      {
        test: {
          name: 'core',
          include: ['packages/core/src/__tests__/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'adapters',
          include: ['packages/adapters/src/__tests__/**/*.test.ts'],
          environment: 'happy-dom',
        },
      },
      {
        test: {
          name: 'integration-security',
          include: ['tests/**/*.test.ts'],
          environment: 'node',
        },
      },
    ],
  },
});
