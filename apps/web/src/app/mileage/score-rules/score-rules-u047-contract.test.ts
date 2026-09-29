import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')

/**
 * #975 U047: 390pxでルール名が4文字程度に省略され、頻度の折れと
 * 編集・削除が密集していた。狭い幅では名前を1段目の全幅に、
 * 点数・頻度・削除を2段目へ下げる。
 */
describe('スコアールールの行（#975 U047）', () => {
  it('狭い幅では名前が1段目の全幅を使う', () => {
    expect(PAGE).toContain('col-span-12 flex min-w-0 items-center gap-3 text-left font-semibold text-ink')
    expect(PAGE).toContain('sm:col-span-6')
  })

  it('点数と頻度は2段目へ下がり、削除は右端に残る', () => {
    expect(PAGE).toContain('col-span-2 text-left text-sm font-bold text-ink sm:text-right')
    expect(PAGE).toContain('col-span-9 text-xs text-ink-secondary sm:col-span-3')
    expect(PAGE).toContain('col-span-1 justify-self-end')
  })

  it('点数の向きは色ではなく文字（＋・−・0にする）で持つ', () => {
    expect(PAGE).toContain('rulePointLabel(rule)')
    expect(PAGE).toContain('ruleFrequencyLabel(rule)')
  })

  it('省略した名前は title で全文を確認できる', () => {
    expect(PAGE).toContain('title={rule.name}')
  })
})
