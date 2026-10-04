import { defineConfig } from 'vitest/config'
import base from '../../../vitest.config'

// 本番exportと基準コミットを使う、手元の画像比較だけで実行する。
export default defineConfig({
  ...base,
  test: { ...base.test, include: ['src/app/v8-parts/v7-preservation.manual.tsx'] },
})
