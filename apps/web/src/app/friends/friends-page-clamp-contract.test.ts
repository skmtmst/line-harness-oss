import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 友だち一覧のページ範囲補正の契約試験(#979 A03-01)。
 *
 * 対象は `apps/web/src/app/friends/page.tsx`。
 * `loadFriends` は取得の間 `total` を 0 に落とす。読み込み中に
 * 「ページ > 総ページ数」の補正を評価すると、2ページ目以降の取得中に
 * totalPages が 1 へ下がり、勝手に1ページ目へ戻ってしまう。
 * 補正は応答が届いて ready になった時点でだけ評価しなければならない。
 * 補正そのもの（範囲外ページを内側へ戻す意味）は残す。
 */

const PAGE = readFileSync(join(__dirname, 'page.tsx'), 'utf8')

describe('友だち一覧のページ範囲補正(#979 A03-01)', () => {
  it('範囲外ページの補正は読み込み中に評価しない', () => {
    const clamp = PAGE.match(/useEffect\(\(\) => \{[\s\S]*?page > totalPages[\s\S]*?\}, \[loadStatus, page, totalPages\]\)/)
    expect(clamp).not.toBeNull()
    expect(clamp![0]).toContain("loadStatus === 'ready' && page > totalPages")
  })

  it('範囲外ページを内側へ戻す補正そのものは残す', () => {
    expect(PAGE).toContain('const totalPages = Math.max(1, Math.ceil(total / pageSize))')
    expect(PAGE).toContain('setPage(totalPages)')
  })
})
