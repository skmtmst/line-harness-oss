import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'page.tsx'), 'utf8')

/*
 * U018/U041: 統合ユーザー（/users と /friends?tab=merged で同じ画面）。
 * 390pxでは検索・絞り込みが操作と同じ帯に入って潰れ、7列の表は見出しが
 * 衝突していた。共通部品は変えず、画面側の印＋scoped styleで縦へ逃がす。
 */
describe('U018 統合ユーザーの検索・絞り込みを縦へ逃がす', () => {
  it('検索・絞り込みを操作行とは別の専用行にする', () => {
    expect(PAGE).toContain('data-users-actions="true"')
    expect(PAGE).toContain('data-users-filters')
    expect(PAGE).toContain('[data-users-filters] > div { flex-wrap: wrap; }')
    expect(PAGE).toContain('[data-users-filters] [data-design-node="phlR1"] { flex: 1 1 100%; }')
  })

  it('作成・CSV・再計算の操作は残す', () => {
    expect(PAGE).toContain('＋ 統合ユーザーを作成')
    expect(PAGE).toContain('CSVで書き出す')
    expect(PAGE).toContain('再計算')
    expect(PAGE).toContain('UsersFilters')
  })
})

describe('U041 統合ユーザー表の見出しの衝突', () => {
  it('表は枠の内側で横へ動かせる', () => {
    expect(PAGE).toContain('data-scroll-table')
    expect(PAGE).toContain('[data-scroll-table] > div { overflow-x: auto; }')
    expect(PAGE).toContain('[data-scroll-table] table { min-width: 860px; }')
  })
})
