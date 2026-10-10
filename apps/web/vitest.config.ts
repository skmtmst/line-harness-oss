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
      /*
       * 実物の worker ルートを画面試験へ mount すると、packages/db が
       * Workers 専用の 'cloudflare:workers' を読みにいって解決に落ちる。
       * 読み出し側は「無い環境」を try/catch で許容するので空の実物を当てる。
       */
      'cloudflare:workers': fileURLToPath(new URL('./src/test-utils/cloudflare-workers-stub.ts', import.meta.url)),
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
    // 全画面のソースを読む見張りの試験は、CI が混むと既定の 5 秒を超える。待つ上限だけ伸ばす（速さの見張りは別の検査）。
    testTimeout: 30_000,
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
