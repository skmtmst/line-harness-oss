import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  /*
   * Next.jsのSWCビルドは自動JSXランタイムを使うため、shared配下の
   * コンポーネントは `React` を自前でimportしていない。試験だけ
   * classicへ倒すと「実コンポーネントをmount」する試験がその配下を
   * 描画した瞬間に落ちる。ビルド本体と同じ自動ランタイムに合わせる。
   */
  esbuild: {
    jsx: 'automatic',
  },
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
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
