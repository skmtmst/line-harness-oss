import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 撮影モード (VITE_LIFF_QA=1 でビルド) のときだけ、@line/liff を
// 偽物 (src/lib/liff-qa.ts) に読み替える。通常ビルドでは alias を
// 付けないので、本番の束に偽物は入らない。
const isQa = process.env.VITE_LIFF_QA === '1';

export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist' },
  resolve: isQa
    ? {
        alias: {
          '@line/liff': fileURLToPath(new URL('./src/lib/liff-qa.ts', import.meta.url)),
        },
      }
    : {},
});
