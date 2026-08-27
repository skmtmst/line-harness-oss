import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const LIST = readFileSync(join(HERE, 'page.tsx'), 'utf8')

/**
 * 一覧の「回答」の帯が、全フォームの合計を出すこと。
 *
 * 以前は `submissions.length`（いま開いているフォームの、読み込んだぶん）
 * でした。フォームを選ぶまで 0 なので、**下の札が「1,284件の回答」と
 * 出ているのに帯は「回答 0件」**になります。同じ画面で数が食い違って
 * 見えるので、どちらが本当か決められません。
 *
 * `submitCount` は一覧の返事に最初から入っています。
 */
describe('回答フォーム一覧の帯', () => {
  it('「回答」に、いま開いているぶんではなく合計を出す', () => {
    expect(LIST).toContain('totalSubmitCount')
    expect(LIST).toContain("sum + (form.submitCount ?? 0)")
  })

  it('「読み込んだぶん」という但し書きを出さない', () => {
    expect(LIST).not.toContain('読み込んだぶん')
    expect(LIST).toContain('すべてのフォームの合計')
  })
})
