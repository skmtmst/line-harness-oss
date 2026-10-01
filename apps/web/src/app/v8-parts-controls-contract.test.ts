/*
 * ★V8 移行④a「基本の操作系を V8 に」の固定。
 *
 *   - ボタン・アイコンボタン・選ぶ欄・探す欄・チェック・ラベル・
 *     トグル・タブ・絞り込みの札・タグ・状態の札 が
 *     `[data-theme="v8"]` の下で V8 の寸法・色に切り替わる
 *   - 動かす値は globals.css の語彙（--shadow-primary-action など）を読む
 *   - v7 の見た目は変えない（全部 v8 セレクタの下）
 *
 * 値の出どころは Pencil ★V8 部品板と lh-work/design/v8/MOTION.md。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { collectReport } from '../../scripts/theme-migration-report.mjs'

const WEB = join(__dirname, '..', '..')
const SHARED = join(WEB, 'src/components/shared')
const globals = readFileSync(join(WEB, 'src/app/globals.css'), 'utf8')
const css = (name: string) => readFileSync(join(SHARED, name), 'utf8')

/** ある部品ファイルの v8 ブロック（全部まとめた文字列）を返す。 */
function v8Blocks(source: string, file: string) {
  const blocks = [...source.matchAll(/\[data-theme=["']?v8["']?\][^{]*\{([^}]*)\}/g)]
  expect(blocks.length, `${file} に [data-theme="v8"] の規定が無い`).toBeGreaterThan(0)
  return blocks.map((b) => b[1]).join('\n')
}

describe('V8 移行④a — 基本の操作系', () => {
  it('V8 の語彙（影・オフの地・星の黄）が globals.css にある', () => {
    for (const token of [
      '--shadow-primary-action',
      '--color-toggle-off: #c9ced6',
      '--color-star-on: #fbbf24',
    ]) {
      expect(globals).toContain(token)
    }
  })

  it('ボタン：高さ36・文字13・主は緑の影・副は薄い影', () => {
    const blocks = v8Blocks(css('button.module.css'), 'button')
    expect(blocks).toContain('font-size: var(--text-label)')
    expect(blocks).toContain('height: 36px')
    expect(blocks).toContain('box-shadow: var(--shadow-primary-action)')
    expect(blocks).toContain('box-shadow: var(--shadow-board)')
  })

  it('アイコンボタン：36×36・白地・細い枠・角丸 control', () => {
    const blocks = v8Blocks(css('icon-button.module.css'), 'icon-button')
    expect(blocks).toContain('width: 36px')
    expect(blocks).toContain('border: 1px solid var(--color-hairline)')
    expect(blocks).toContain('background: var(--color-canvas)')
  })

  it('選ぶ欄：高さ36・文字13/500', () => {
    const blocks = v8Blocks(css('select.module.css'), 'select')
    expect(blocks).toContain('height: 36px')
    expect(blocks).toContain('font-size: var(--text-label)')
    expect(blocks).toContain('font-weight: 500')
  })

  it('探す欄：高さ36・余白 0 12', () => {
    const blocks = v8Blocks(css('search-field.module.css'), 'search-field')
    expect(blocks).toContain('height: 36px')
    expect(blocks).toContain('padding: 0 12px')
  })

  it('チェックとラベル：文字は 13px（欄そのものは v7 と同じ）', () => {
    expect(v8Blocks(css('checkbox.module.css'), 'checkbox')).toContain('font-size: var(--text-label)')
    const labels = v8Blocks(css('form-controls.module.css'), 'form-controls')
    expect(labels).toContain('font-size: var(--text-label)')
    expect(labels).toContain('color: var(--color-ink)')
  })

  it('トグル：オフの地は操作する部品の枠色（control-border）、オンは変わらない', () => {
    const blocks = v8Blocks(css('toggle.module.css'), 'toggle')
    expect(blocks).toContain('background: var(--color-control-border)')
    expect(blocks).toContain('background: var(--color-accent-deep)')
  })

  it('タブ：選んだタブは緑ではなく墨の下線・墨の600・下線が滑る動き', () => {
    const blocks = v8Blocks(css('tabs.module.css'), 'tabs')
    expect(blocks).toContain('border-bottom-color: var(--color-ink)')
    expect(blocks).toContain('color: var(--color-ink)')
    expect(blocks).toContain('font-weight: 600')
    expect(blocks).toContain('var(--motion-fast)')
  })

  it('絞り込みの札：高さ30・選ぶと墨の地に白文字（緑ではない）', () => {
    const blocks = v8Blocks(css('filter-chip.css'), 'filter-chip')
    expect(blocks).toContain('height: 30px')
    expect(blocks).toContain('background: var(--color-ink)')
  })

  it('タグ：文字12・余白 2/8・中立は白地に ink-secondary', () => {
    const blocks = v8Blocks(css('chip.module.css'), 'chip')
    expect(blocks).toContain('font-size: var(--text-caption)')
    expect(blocks).toContain('color: var(--color-ink-secondary)')
  })

  it('状態の札：余白 2/8・文字600・色の点（currentColor）が付く', () => {
    const blocks = v8Blocks(css('status-badge.module.css'), 'status-badge')
    expect(blocks).toContain('padding: 2px 8px')
    expect(blocks).toContain('font-weight: 600')
    expect(blocks).toContain('background: currentColor')
  })

  it('台帳がこの回の部品を v8対応済みと数える', { timeout: 60_000 }, () => {
    const report = collectReport()
    const done = ['ボタン', 'アイコンボタン', '選ぶ欄', '検索', 'チェック', 'ラジオ', 'トグル', 'タブ', '絞り込みの札', 'タグ', '状態の札']
    for (const name of done) {
      const part = report.parts.find((p) => p.name === name)
      expect(part?.status, `${name} が v8対応済みになっていない`).toBe('v8対応済み')
    }
  })
})
