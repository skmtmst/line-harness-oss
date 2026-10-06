import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const EDITOR = readFileSync(join(HERE, 'friend-add-rule-editor.tsx'), 'utf8')
const EDITOR_CSS = readFileSync(join(HERE, 'friend-add-rule-editor.css'), 'utf8')

/*
 * V8 友だち追加時の配信の細かい板（sFwWf・h5rm8t）。
 * テスト段の確認は同じ画面の状態として板IDを付け、
 * 編集の競合は帯で知らせて書き換えない。v7 は変えない。
 */
describe('友だち追加時の配信の細かい板', () => {
  it('テスト段の確認に板IDを付ける（sFwWf）', () => {
    expect(EDITOR).toContain('data-design-node="sFwWf"')
    expect(EDITOR).toContain('実際の友だちへの')
  })

  it('編集の競合は帯・比べる・読み直しを出す（h5rm8t）', () => {
    expect(EDITOR).toContain('data-design-node="h5rm8t"')
    expect(EDITOR).toContain('ほかの人がこの初回案内を更新しました')
    expect(EDITOR).toContain('違いを比べる')
    expect(EDITOR).toContain('最新を読み込んで続ける')
  })

  it('競合の帯の見た目は直接の色・丸み・影を書かない', () => {
    const conflictLine = EDITOR_CSS.split('\n').find((line) => line.startsWith('.friend-add-editor-conflictBar '))
    expect(conflictLine).toBeDefined()
    expect(conflictLine).toContain('var(--color-warning-bg)')
    expect(conflictLine).toContain('var(--radius-card')
    expect(conflictLine).not.toContain('box-shadow')
    expect(conflictLine).not.toMatch(/#[0-9a-fA-F]{3,8}/)
    expect(EDITOR_CSS).toContain('.friend-add-editor-conflictActions')
  })
})
