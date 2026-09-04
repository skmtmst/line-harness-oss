import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')

/**
 * テンプレート一覧（設計 `W7LBc` 11-1）に、内部の値を出さない。
 *
 * #10 の撮影で、種類の欄に `text`、種類の札に `Flex` `Carousel` が出て
 * いた。**LINE の作りの名前は運用する人には通じない。**
 */
describe('種類の呼び方', () => {
  it('LINEの作りの名前をそのまま出さない', () => {
    expect(PAGE).toContain("flex: 'カード型'")
    expect(PAGE).toContain("carousel: 'カルーセル'")
    expect(PAGE, '内部の名前が残っている').not.toMatch(/flex: 'Flex'|carousel: 'Carousel'/)
  })

  it('絞り込みの札にも内部の名前を出さない', () => {
    /* 一覧の上の札と、作る画面の選び口。どちらも運用の言葉にする。 */
    expect(PAGE).toContain("{ key: 'flex', label: 'カード型' },")
    /* 選び口は共通の `SelectField` へ寄せたので、options で並ぶ。 */
    expect(PAGE).toContain("{ value: \"flex\", label: \"カード型\" }")
    expect(PAGE, '失敗の文に内部の語が出ている').not.toContain('Flex JSON parse 失敗')
  })

  it('知らない種類でも内部の値を出さない', () => {
    /*
     * `?? t.messageType` だと、`sticker` や `video` のひな形が並んだとき
     * **画面に英語の値がそのまま出る**。
     */
    expect(PAGE).toContain("return messageTypeLabels[type] ?? 'その他'")
    expect(PAGE).not.toContain('?? t.messageType}')
  })

  it('`category` を画面へ流さない', () => {
    /* `text` `general` は内部の値。分け方はフォルダが受け持つ。 */
    expect(PAGE, 'category を出している').not.toMatch(/\{t\.category \|\| '未分類'\}/)
  })
})

/**
 * 使用先の数（要件 §9「未取得は `—` とラベル」）。
 */
describe('使われている数', () => {
  it('数えられていないものを 0 と書かない', () => {
    /*
     * `usageCount` を持たないひな形で「undefined件で使用」と出ていた。
     * **0 は「どこでも使われていない」という別の意味。**
     */
    expect(PAGE).toContain("typeof t.usageCount !== 'number' ? '使用先を確認できません'")
    /* 数があるときだけ「N件で使用」。0 は「なし」と書き分ける。 */
    expect(PAGE).toContain("t.usageCount === 0 ? 'なし'")
  })
})
