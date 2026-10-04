import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'columns', 'new', 'column-new-v8.tsx'),
  'utf8',
)

/*
 * #972 U036: 390pxでは「前のコラムを下敷きにする」が幅を取り、
 * パンくずと見出し・説明が細い列に潰れていた。収まらない幅では
 * 操作を次の行へ下げる。
 */
describe('コラム作成の補助操作をV8にも残す', () => {
  it('補助操作そのものは残す', () => {
    expect(PAGE).toContain('前のコラムを下敷きにする')
  })
})
