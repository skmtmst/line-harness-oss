import { defineConfig } from 'vitest/config';
import path from 'path';

// 大きいデータの速度の見張りだけを走らせる設定。通常の試験とは分けて、週1回と手動の job から呼ぶ。
// vitest.config.ts と mergeConfig すると include が足し合わされて通常の試験まで走るので、別に書く。
export default defineConfig({
  resolve: {
    alias: {
      '@line-crm/line-sdk': path.resolve(__dirname, '../../packages/line-sdk/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    globals: false,
    include: ['scripts/scale-benchmark.scale.ts'],
    maxWorkers: 1,
    testTimeout: 60 * 60_000,
    hookTimeout: 60_000,
  },
});
