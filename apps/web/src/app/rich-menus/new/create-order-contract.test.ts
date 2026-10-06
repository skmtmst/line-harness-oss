import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const CSS = readFileSync(join(HERE, 'create-v8.module.css'), 'utf8')
const TSX = readFileSync(join(HERE, 'create-v8.tsx'), 'utf8')

/**
 * 板 `OxEMM`（リッチメニュー 作る③ 誰に出すか）「出す順番」の行の形。
 * 絵の HTML の数値どおり：行の間 6、順番の数字は丸い札にせず裸の 13px
 * 太字（灰色・自分は濃い緑）、自分の行の枠は濃い緑。
 */
function block(selector: string): string {
  const at = CSS.indexOf(selector)
  if (at < 0) throw new Error(`missing ${selector}`)
  return CSS.slice(at, CSS.indexOf('}', at))
}

describe('リッチメニュー作る③の出す順番（OxEMM）', () => {
  it('行の間は 6、自分の行の枠は濃い緑', () => {
    expect(block('.orderList {')).toContain('gap: 6px')
    expect(block('.orderRowSelf {')).toContain('var(--color-accent-deep)')
  })

  it('順番の数字は丸い札にせず裸の 13px 太字', () => {
    const num = block('.orderNum {')
    expect(num).toContain('font-size: 13px')
    expect(num).not.toContain('border-radius')
    expect(num).not.toContain('background')
    expect(block('.orderRowSelf .orderNum {')).toContain('var(--color-accent-deep)')
  })

  it('「トークを開いたとき」の前の短い字は太字にしない', () => {
    expect(block('.segLabelPlain {')).toContain('font-weight: 400')
    expect(TSX).toContain('segLabelPlain')
  })
})
