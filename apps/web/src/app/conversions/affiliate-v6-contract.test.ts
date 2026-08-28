import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')
const TABS = readFileSync(new URL('../affiliates/tabs.tsx', import.meta.url), 'utf8')
const LEGACY_PAGE = readFileSync(new URL('../affiliates/page.tsx', import.meta.url), 'utf8')
const API = readFileSync(new URL('../../lib/api.ts', import.meta.url), 'utf8')

describe('V6 成果・アフィリエイトの契約', () => {
  it('紹介者・案件・成果承認をV6実Nodeへ結ぶ', () => {
    expect(PAGE).toContain("affiliates: 'PouPn'")
    expect(PAGE).toContain("offers: 'GH8VL'")
    expect(PAGE).toContain("approvals: 'n5VVTb'")
    expect(TABS).toContain('data-design-node="PouPn"')
  })

  it('本文に画面タイトル・説明・準備中マニュアルを重ねない', () => {
    expect(PAGE).not.toContain("import Header from")
    expect(PAGE).not.toContain('マニュアルは準備中です')
    expect(LEGACY_PAGE).not.toContain("import Header from")
    expect(LEGACY_PAGE).toContain("redirect('/conversions?tab=affiliates')")
  })

  it('紹介者一覧の空・読込・失敗を言い分ける', () => {
    expect(TABS).toContain('kind="error"')
    expect(TABS).toContain('kind="loading"')
    expect(TABS).toContain('kind="empty"')
  })

  it('紹介者を物理削除するクライアントAPIを持たない', () => {
    expect(API).not.toContain("fetchApi<ApiResponse<null>>(`/api/affiliates/${id}`, { method: 'DELETE' })")
  })
})
