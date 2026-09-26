import { defineConfig } from 'vitest/config';

// 文面だけ読む試験は node のまま。ConfirmDialog の Esc・フォーカスだけ
// 実際に描いて確かめる (試験ファイル先頭の1行で happy-dom へ切り替える)。
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
