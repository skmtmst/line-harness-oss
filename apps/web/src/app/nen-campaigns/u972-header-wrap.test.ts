import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'columns', 'new', 'page.tsx'),
  'utf8',
)

/*
 * #972 U036: 390pxでは「前のコラムを下敷きにする」が幅を取り、
 * パンくずと見出し・説明が細い列に潰れていた。収まらない幅では
 * 操作を次の行へ下げる。
 */
describe('U036 コラム作成の見出しと右側操作の分離', () => {
  it('見出し帯に折り返しの印と上書きがある', () => {
    expect(PAGE).toContain('data-page-header-wrap')
    expect(PAGE).toContain('[data-page-header-wrap] > div { flex-wrap: wrap; }')
    expect(PAGE).toContain('[data-page-header-wrap] > div > div + div')
    expect(PAGE).toContain('margin-left: auto')
  })

  it('補助操作そのものは残す', () => {
    expect(PAGE).toContain('前のコラムを下敷きにする')
  })
})
