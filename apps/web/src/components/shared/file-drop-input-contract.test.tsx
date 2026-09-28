// @vitest-environment happy-dom
/**
 * ファイルを選ぶ裏の input（1px・透明）は、見えない入力欄として
 * 検出される（高さ1）。裏の input は出さない（display:none）。
 * 開くのは「ファイルを選ぶ」ボタンからの programmatic click のまま。
 * キーボード・読み上げの入口はボタンのまま変えないことが約束。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import FileDropzone from './file-drop'

const DIR = dirname(fileURLToPath(import.meta.url))
const styles = readFileSync(join(DIR, 'file-drop.module.css'), 'utf8')

describe('ファイル選択の裏の input は出さない（m22a）', () => {
  it('.input は display:none', () => {
    const match = styles.match(/\.input\s*\{([^}]*)\}/)
    if (!match) throw new Error('.input が file-drop.module.css にありません')
    expect(match[1]).toMatch(/display:\s*none/)
  })

  it('裏の input は読み上げ・キーボードの対象外のまま', () => {
    render(<FileDropzone title="ここにCSVを置く" onFiles={() => {}} />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement | null
    if (!input) throw new Error('file input がありません')
    expect(input.getAttribute('aria-hidden')).toBe('true')
    expect(input.tabIndex).toBe(-1)
  })
})
