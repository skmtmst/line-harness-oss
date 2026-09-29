import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')
const CSS = readFileSync(join(HERE, 'new-automation.module.css'), 'utf8')

/*
 * #973 U023: 自動化の新規作成（/automations/new）で
 * 「すること」と「付けるタグ」などの対象設定が2列のまま潰れていた。
 */
describe('自動化作成のはみ出し（#973 U023）', () => {
  it('処理の種類と対象の設定は狭い幅では縦に並ぶ', () => {
    // 「すること」欄の直前に来るグリッドは、狭い幅で1列、広い幅だけ2列。
    expect(PAGE).toContain('grid gap-3 lg:grid-cols-2')
    const actionGrid = PAGE.match(/grid gap-3 lg:grid-cols-2[\s\S]{0,400}?au-action-/)
    expect(actionGrid, '「すること」欄を包むグリッドが縦配置になっていない').not.toBeNull()
  })

  it('固定最小幅の2列（190px+260px）は390pxを通らないので持たない', () => {
    expect(CSS).not.toContain('minmax(190px')
    expect(CSS).not.toContain('minmax(260px, 1.2fr)')
  })
})
