import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'pets-tab.tsx'), 'utf8')

/**
 * #984 LAY-17: ペット一覧の操作列。
 *
 * 幅64px（w-16）の操作列に「編集」「詳細」が入らず、1文字ずつ縦に
 * 折れていた。幅を先に確保し、折り返さず、縮まないこと。
 * スマホでは細い表の列に頼らず、カードの下に操作行を置く。
 */
describe('ペット一覧の操作列（#984 LAY-17）', () => {
  it('表の操作列は先に幅を確保する', () => {
    // 「飼い主」「編集」の枠付きボタンが横に並べて入る幅。w-16（64px）へは戻さない。
    expect(PAGE).toContain('w-40')
    expect(PAGE).not.toContain('<Th className="w-16"')
  })

  it('操作は折り返さず縮まない', () => {
    // 折り返し禁止は共用 ActionCell と RowActions（white-space: nowrap）で担保する。
    expect(PAGE).toContain('<ActionCell>')
    expect(PAGE).toContain('<RowActions')
  })

  it('行の操作は共用 RowActions で「詳細→編集」の順にする（#985 LAY-18）', () => {
    // 「詳細」の行き先は飼い主の友だち詳細なので「飼い主」と明記する。
    expect(PAGE).toContain("import { RowActions } from '@/components/shared/row-actions'")
    expect(PAGE).toContain("detail={{ label: '飼い主'")
    expect(PAGE).toContain('edit={canEdit ? { onClick: onEdit } : undefined}')
    // 画面ごとの裸の文字リンク・ボタン装飾へは戻さない。
    expect(PAGE).not.toContain('text-accent-deep">編集</button>')
  })

  it('スマホではカードの下に操作行を置く', () => {
    expect(PAGE).toContain('md:hidden')
    expect(PAGE).toContain('hidden md:block')
    expect(PAGE).toContain('data-design="CardActions"')
    expect(PAGE).toContain('function PetCard(')
  })
})
