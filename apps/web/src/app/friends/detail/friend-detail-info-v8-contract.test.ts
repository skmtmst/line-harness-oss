import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')

/*
 * ★V8 `Q5F2QE`：友だち詳細の情報欄タブ。
 * 項目は V8の2列に並べ、板IDを付ける。v7 は縦1列のまま。
 * 分類の切り替え・件数・保存の決まり（N-045）は変えない。
 */
describe('情報欄タブのV8（Q5F2QE）', () => {
  it('V8の板IDを付ける', () => {
    expect(PAGE).toContain('data-design-node="Q5F2QE"')
    expect(PAGE).not.toContain('useAdminTheme')
  })

  it('V8の項目を2列に並べる', () => {
    expect(PAGE).toContain('sm:grid-cols-2')
    expect(PAGE).toContain('className="min-w-0"')
  })

  it('分類・保存の決まりはそのまま', () => {
    expect(PAGE).toContain('aria-label="情報欄の分類"')
    expect(PAGE).toContain('保存する')
    expect(PAGE).toContain('情報欄の値を保存できるのはオーナー・管理者')
  })
})
