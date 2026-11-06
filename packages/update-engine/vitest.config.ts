import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    maxWorkers: 4,
    // Vitest 4 restoreAllMocks no longer clears standalone vi.fn call history.
    clearMocks: true,
    environment: 'node',
    globals: false,
    include: ['test/**/*.test.ts'],
  },
});
