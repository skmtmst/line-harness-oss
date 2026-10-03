import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')

/*
 * 友だち詳細 `Q5F2QE` の残りタブ（概要・履歴・回答フォームのV8）。
 * 情報欄タブは #1236 の分。合流したら1枚になる。
 * 3タブとも中身は見本どおりにそろっているので、V8だけ板IDを付ける。
 * v7 は変えない。
 */
describe('友だち詳細の残りタブ（Q5F2QE）', () => {
  it('概要・履歴・回答フォームに板IDを付ける（V8だけ）', () => {
    const hits = PAGE.match(/data-design-node=\{v8 \? 'Q5F2QE' : undefined\}/g) ?? []
    expect(hits.length).toBe(3)
  })

  it('3タブの見せ場はそのまま', () => {
    expect(PAGE).toContain('進行中の配信・自動処理')
    expect(PAGE).toContain('さらに読み込む')
    expect(PAGE).toContain('フォームの回答はまだありません')
  })
})
