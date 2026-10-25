import { defineConfig } from 'vitest/config';

export default defineConfig({
  // 部品（.tsx）を試験で描くため、Next と同じ自動 runtime で JSX を読む。
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    maxWorkers: 4,
    // Vitest 4 restoreAllMocks no longer clears standalone vi.fn call history.
    clearMocks: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
