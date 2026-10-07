import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const CSS = readFileSync(join(HERE, 'create-v8.module.css'), 'utf8')
const TSX = readFileSync(join(HERE, 'create-v8.tsx'), 'utf8')

/**
 * 板 `F4gELj`（リッチメニュー 作る④ 公開）「公開の前の確認」の行の形。
 * 絵の HTML の数値どおり：行は下の薄い線（内側の影の線）で区切り、余白は上下 10、
 * 印は 18・通った印は濃い緑、1・2行目の「見直す」は文字だけのボタン、
 * 実機未確認の印は黄色の注意、注意の帯はこの段の中。
 */
function block(selector: string): string {
  const at = CSS.indexOf(selector)
  if (at < 0) throw new Error(`missing ${selector}`)
  return CSS.slice(at, CSS.indexOf('}', at))
}

describe('リッチメニュー作る④の公開前確認（F4gELj）', () => {
  it('行は下の薄い線・上下10・印は18', () => {
    const row = block('.checkRow {')
    expect(row).toContain('padding: 10px 0')
    expect(row).toContain('box-shadow: var(--shadow-row-line)')
    expect(block('.checkIcon {')).toContain('width: 18px')
  })

  it('通った印は濃い緑・実機未確認は黄色の注意', () => {
    expect(block('.checkIconOk {')).toContain('var(--color-accent-deep)')
    expect(block('.checkIconWarn {')).toContain('var(--color-warning)')
    expect(TSX).toContain('checkIconWarn')
  })

  it('「見直す」は文字だけのボタン（button役割を保つ）', () => {
    expect(block('.checkRetry {')).toContain('background: transparent')
    expect(TSX).toContain('className={styles.checkRetry}')
  })

  it('注意の帯は公開前確認の段の中にある', () => {
    const headAt = TSX.indexOf('公開の前の確認')
    const bandAt = TSX.indexOf('styles.infoBand', headAt)
    const railAt = TSX.indexOf('function renderRail')
    expect(bandAt).toBeGreaterThan(headAt)
    expect(railAt).toBeGreaterThan(bandAt)
    expect(block('.infoBand {')).toContain('var(--color-status-info-soft')
  })
})
