import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const CSS = readFileSync(join(HERE, 'create-v8.module.css'), 'utf8')

/**
 * 板 `Z0uO6`（リッチメニュー 作る② ボタンの動き）「面の一覧」の形。
 * 絵の HTML の数値どおり：記号 22px・角丸 6、未選択は薄い地＋灰色の字、
 * 選んだ行の記号は濃い緑 `#087a3e`（accent-deep）、要約と未設定は 11px。
 */
function block(selector: string): string {
  const at = CSS.indexOf(selector)
  if (at < 0) throw new Error(`missing ${selector}`)
  return CSS.slice(at, CSS.indexOf('}', at))
}

describe('リッチメニュー作る②の面の一覧（Z0uO6）', () => {
  it('未選択の記号は薄い地＋灰色の字', () => {
    const b = block('.areaLetter {')
    expect(b).toContain('var(--color-surface-pearl)')
    expect(b).toContain('var(--color-ink-secondary)')
  })

  it('選んだ行の記号は濃い緑・白い字', () => {
    const b = block('.areaRowOn .areaLetter {')
    expect(b).toContain('var(--color-accent-deep)')
    expect(b).toContain('#ffffff')
  })

  it('動きの要約と未設定は 11px、未設定は太字にしない', () => {
    expect(block('.areaAction {')).toContain('font-size: 11px')
    const unset = block('.areaUnset {')
    expect(unset).toContain('font-size: 11px')
    expect(unset).not.toContain('font-weight: 600')
  })
})
