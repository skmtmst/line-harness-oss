import { readUiSource, readUiSource as readFileSync } from '../../../scripts/test-ui-source.mjs'
import { describe, expect, it } from 'vitest'

const PAGE = readUiSource(new URL('./page.tsx', import.meta.url), 'utf8')
const TABS = readFileSync(new URL('../../v8/affiliates/affiliators.tsx', import.meta.url), 'utf8')
const LEGACY_PAGE = readFileSync(new URL('../affiliates/page.tsx', import.meta.url), 'utf8')
const API = readFileSync(new URL('../../lib/api.ts', import.meta.url), 'utf8')

/**
 * 管理画面 成果・アフィリエイトの禁止の見張り。
 * 古いタブの URL を /affiliates へ移すこと・/affiliates が V8 を描くこと・紹介者一覧の読込／失敗／空・
 * 報酬の列は描画の試験が確かめる（conversion-points-rowmenu-react.test.tsx、
 * app/affiliates/affiliates-v8-design.test.tsx、v8/affiliates/affiliators.test.tsx）。
 */
describe("管理画面 成果・アフィリエイトの契約", () => {

  it('本文に画面タイトル・説明・準備中マニュアルを重ねない', () => {
    expect(PAGE).not.toContain("import Header from")
    expect(PAGE).not.toContain('マニュアルは準備中です')
    expect(LEGACY_PAGE).not.toContain("import Header from")
  })

  it('紹介者を物理削除するクライアントAPIを持たない', () => {
    expect(API).not.toContain("fetchApi<ApiResponse<null>>(`/api/affiliates/${id}`, { method: 'DELETE' })")
  })

  it('一覧の報酬を割合だけの参考値の列にしない', () => {
    expect(TABS).not.toContain('<Th align="right">参考報酬</Th>')
  })
})
