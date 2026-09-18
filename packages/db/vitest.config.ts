import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    // CIの4vCPUでworkerをCPU数いっぱいに立てると、集約側が60sのbirpc
    // onTaskUpdateタイムアウトを踏み全件成功でも exit 1 になる既知のflaky。
    // fork数を絞って集約プロセスへCPUを残す。
    poolOptions: {
      forks: { maxForks: 2 },
    },
  },
});
