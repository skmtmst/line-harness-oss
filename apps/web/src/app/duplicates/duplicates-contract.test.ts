import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'page.tsx'), 'utf8')

/**
 * #984 LAY-12/16: 重複検出の表見出しと0件の件数表示。
 *
 * 見出しは共通の TableHeadRow/Th を通す（画面ごとの直書き th は残さない）。
 * 件数0のとき「0組中 1〜0組」と出していた回帰を防ぎ、
 * 検索で0件のときは解除の導線を必ず出す。
 */
describe('重複検出の表見出しと0件表示（#984 LAY-12/16）', () => {
  it('見出しは共通の TableHeadRow/Th を通す', () => {
    expect(PAGE).toContain("import { TableHeadRow, Th } from '@/components/shared/table'")
    expect(PAGE).toContain('<TableHeadRow>')
    expect(PAGE).not.toMatch(/<th\b/)
  })

  it('候補が0件のとき「1〜0組」を出さない', () => {
    expect(PAGE).toContain('candidateTotal === 0')
    expect(PAGE).toContain("'0組'")
    expect(PAGE).not.toContain('1〜0')
  })

  it('検索で0件のとき解除の導線を出す', () => {
    expect(PAGE).toContain('検索条件に合う候補はありません')
    expect(PAGE).toContain('検索条件を解除する')
    expect(PAGE).toContain("setQuery(''); setStatus('')")
  })
})
