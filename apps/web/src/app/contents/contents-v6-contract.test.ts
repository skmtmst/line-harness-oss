import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')
const API = readFileSync(new URL('../../lib/api.ts', import.meta.url), 'utf8')

describe('V6 登録メディア一覧の契約', () => {
  it('V6の実Nodeと共通状態部品を使う', () => {
    expect(PAGE).toContain('data-design-node="g89Tc"')
    expect(PAGE).toContain('<ListState kind="loading"')
    expect(PAGE).toContain('kind="error"')
    expect(PAGE).toContain('kind="empty"')
  })

  it('本文に画面タイトルと準備中のマニュアルを重ねない', () => {
    expect(PAGE).not.toContain("import Header from")
    expect(PAGE).not.toContain('マニュアルは準備中です')
  })

  it('未取得の使用数を0件に見せない', () => {
    expect(PAGE).toContain("item.usageCount === undefined ? '—'")
  })

  it('使用中メディアの強制削除口を持たない', () => {
    expect(PAGE).not.toContain('force: true')
    expect(PAGE).toContain('使用先から外すまで削除できません')
    expect(API).not.toContain("`/api/media/${id}${opts?.force ? '?force=1' : ''}`")
  })
})
