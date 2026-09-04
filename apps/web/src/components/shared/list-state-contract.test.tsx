import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import ListState from './list-state'
import Pagination from './pagination'

const HERE = dirname(fileURLToPath(import.meta.url))
const read = (name: string) => readFileSync(join(HERE, name), 'utf8')

/**
 * **中身を出せないときの1枚と、ページ送り。**
 *
 * 一覧が「1件も無い」「読み込めなかった」「権限が無い」を言い分けられないと、
 * 運用者からは**どれも「登録したものが消えた」に見える。**
 *
 * さらに、失敗したときに**運用者にできることが無かった。** 「表示できません
 * でした」とだけ出て、直す手がない。画面を丸ごと読み直すしかなく、それだと
 * 入力中の絞り込みまで消える。
 */
describe('一覧の状態とページ送り', () => {
  it('4つの状態を言い分ける', () => {
    for (const kind of ['loading', 'empty', 'error', 'forbidden'] as const) {
      const html = renderToStaticMarkup(<ListState kind={kind} />)
      expect(html, `${kind} の印が付いていない`).toContain(`data-list-state="${kind}"`)
    }
  })

  it('読み込み中と失敗・権限不足を、読み上げにも伝える', () => {
    expect(renderToStaticMarkup(<ListState kind="loading" />)).toContain('aria-busy="true"')
    // 失敗と権限不足は、その場で読ませる（あとから探しに行かせない）。
    expect(renderToStaticMarkup(<ListState kind="error" />)).toContain('role="alert"')
    expect(renderToStaticMarkup(<ListState kind="forbidden" />)).toContain('role="alert"')
  })

  it('失敗時の再読み込みを、画面に合う言葉で渡せる', () => {
    const html = renderToStaticMarkup(
      <ListState kind="error" action={<button type="button">予約一覧を再読み込み</button>} />,
    )
    expect(html).toContain('予約一覧を再読み込み')
    // 渡さない画面では、重複する一律の押し口を勝手に出さない。
    expect(renderToStaticMarkup(<ListState kind="error" />)).not.toContain('<button')
  })

  it('権限不足は「無い」ではなく「見られない」と言う', () => {
    const html = renderToStaticMarkup(<ListState kind="forbidden" />)
    expect(html).toContain('権限がありません')
    expect(html).not.toContain('データがありません')
  })

  it('送る先が1ページしか無いとき、ページ送りを描かない', () => {
    // 画面ごとに `{pageCount > 1 && …}` と書くと、書き忘れた画面だけ
    // 出たままになる。**部品の側で決める。**
    expect(renderToStaticMarkup(<Pagination page={1} pageCount={1} onPageChange={vi.fn()} />)).toBe('')
    expect(renderToStaticMarkup(<Pagination page={1} pageCount={0} onPageChange={vi.fn()} />)).toBe('')
    expect(renderToStaticMarkup(<Pagination page={1} pageCount={2} onPageChange={vi.fn()} />)).toContain('次へ')
  })

  it('取れなかった数を 0 と出さない', () => {
    // 数の無いところに 0 を入れると、「数えて0だった」と読めてしまう。
    const kpis = read('summary-card.tsx')
    expect(kpis).toMatch(/value === null \? '—'/)
  })
})
