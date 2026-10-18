import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    maxWorkers: 4,
    // Vitest 4 restoreAllMocks no longer clears standalone vi.fn call history.
    clearMocks: true,
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
