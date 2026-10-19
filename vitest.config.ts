import { defineConfig } from 'vitest/config';

// Repository scripts run here. Package suites, including packages/shared,
// use their own configs; CI runs shared in UTC and Asia/Bangkok.
export default defineConfig({
  test: {
    maxWorkers: 4,
    // Vitest 4 restoreAllMocks no longer clears standalone vi.fn call history.
    clearMocks: true,
    environment: 'node',
    globals: false,
    include: ['scripts/**/*.test.ts'],
  },
});
