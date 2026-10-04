import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..')

/*
 * ★V8 テンプレート 一覧（1152）（板 `L7zA7C`）の印の確認。
 * 印が無いと数に入らない。骨格の印（data-design）は v7 側が担うため、
 * ここでは板の印（data-design-node）だけ足す。
 */
describe('テンプレート一覧の板の印（L7zA7C）', () => {
  it('list-v8.tsx の面に L7zA7C が付く', () => {
    const source = readFileSync(join(SRC, 'app/templates/list-v8.tsx'), 'utf8')
    expect(source).toContain('L7zA7C')
    expect(source).toMatch(/data-design-node="[^"]*L7zA7C[^"]*"/)
  })

  it('削除の確認窓に V6JFnd が付く', () => {
    const source = readFileSync(join(SRC, 'app/templates/list-v8.tsx'), 'utf8')
    expect(source).toContain('V6JFnd')
    expect(source).toMatch(/designNode="V6JFnd"/)
  })
})
