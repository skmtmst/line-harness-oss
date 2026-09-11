import { defineConfig } from 'vitest/config';

// LIFF の純粋ロジックの試験。React コンポーネントの描画試験は行わない。
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.ts'],
  },
});
