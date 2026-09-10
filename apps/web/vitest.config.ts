import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    /*
     * `@/` は画面のコードが普通に使っている書き方。ここに無いと、
     * それを1つ import しただけで試験が「ファイルが見つかりません」で
     * 落ちる。落ち方が中身と関係ないので、原因を探すのに時間がかかる。
     */
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  /*
   * 画面と同じJSXの書き方で読む。Next は自動runtime(React を import
   * しなくてもJSXが書ける)なので、試験だけ古い runtime にすると
   * `React is not defined` で落ちる。落ち方が中身と関係ないので、
   * 原因を探すのに時間がかかる(#630)。
   */
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
