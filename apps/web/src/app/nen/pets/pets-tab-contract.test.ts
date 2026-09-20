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
    // 「編集」「詳細」が横に並べて入る幅。w-16（64px）へは戻さない。
    expect(PAGE).toContain('w-28')
    expect(PAGE).not.toContain('<Th className="w-16"')
  })

  it('操作は折り返さず縮まない', () => {
    // 折り返し禁止は共用 ActionCell（white-space: nowrap）で担保する。
    expect(PAGE).toContain('<ActionCell>')
    expect(PAGE).toContain('whitespace-nowrap')
    expect(PAGE).toContain('shrink-0')
  })

  it('スマホではカードの下に操作行を置く', () => {
    expect(PAGE).toContain('md:hidden')
    expect(PAGE).toContain('hidden md:block')
    expect(PAGE).toContain('data-design="CardActions"')
    expect(PAGE).toContain('function PetCard(')
  })
})
