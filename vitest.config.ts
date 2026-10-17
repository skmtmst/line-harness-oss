import { defineConfig } from 'vitest/config';

// Root vitest config — deploy scripts plus the packages that have no vitest of
// their own. `packages/shared` is pure TypeScript with no devDependencies, so
// its tests run here instead of adding vitest to that package.
// Per-package suites (apps/worker, packages/db) keep their own configs.
export default defineConfig({
  test: {
    maxWorkers: 4,
    // Vitest 4 restoreAllMocks no longer clears standalone vi.fn call history.
    clearMocks: true,
    environment: 'node',
    globals: false,
    include: ['scripts/**/*.test.ts', 'packages/shared/src/**/*.test.ts'],
  },
});
