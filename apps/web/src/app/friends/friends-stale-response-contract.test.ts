import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 友だち一覧の応答対象照合の契約試験(#964)。
 *
 * 対象は `apps/web/src/app/friends/page.tsx`。
 * `loadFriends` の応答は「要求ID・対象アカウント・ページ・ページあたり件数
 * (位置)」が現在値と一致するときだけ一覧へ反映しなければならない。
 * Aの2ページ目の応答がBの1ページ目へ遅れて届いても上書きしない。
 */

const PAGE = readFileSync(join(__dirname, 'page.tsx'), 'utf8')

describe('友だち一覧の応答対象照合(#964)', () => {
  it('応答の照合に使う現在値(アカウント・ページ・位置)を描画ごとに同期する', () => {
    expect(PAGE).toContain('const loadContextRef = useRef({ accountId: selectedAccountId, page, pageSize })')
    expect(PAGE).toContain('loadContextRef.current = { accountId: selectedAccountId, page, pageSize }')
  })

  it('要求時のアカウント・ページ・位置を固定する', () => {
    expect(PAGE).toContain('const requestedAccountId = selectedAccountId')
    expect(PAGE).toContain('const requestedPage = page')
    expect(PAGE).toContain('const requestedPageSize = pageSize')
  })

  it('成功応答は要求IDと対象(アカウント・ページ・位置)の両方が一致するときだけ反映する', () => {
    const loadFriends = PAGE.match(/const loadFriends = useCallback[\s\S]*?\}, \[[^\]]*\]\)/)
    expect(loadFriends).not.toBeNull()
    const body = loadFriends![0]
    expect(body).toContain('if (requestId !== loadRequestRef.current) return')
    expect(body).toContain('context.accountId !== requestedAccountId')
    expect(body).toContain('context.page !== requestedPage')
    expect(body).toContain('context.pageSize !== requestedPageSize')
    // 成功系だけでなく失敗(例外)の経路にも同じ照合が要る。
    const guards = body.match(/context\.accountId !== requestedAccountId/g) ?? []
    expect(guards.length).toBeGreaterThanOrEqual(2)
  })

  it('アカウント固有の候補(シナリオ・対応マーク)も別アカウントの遅延応答で上書きしない', () => {
    const loadOptions = PAGE.match(/const loadOptions = useCallback[\s\S]*?\}, \[[^\]]*\]\)/)
    expect(loadOptions).not.toBeNull()
    expect(loadOptions![0]).toContain('if (loadContextRef.current.accountId !== requestedAccountId) return')
  })
})
