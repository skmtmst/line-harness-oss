/*
 * ★V8 移行④b「一覧まわりを V8 に」の固定。
 *
 *   - 板の頭・表（見出し・行）・道具の1段・ページ送り・数の帯・
 *     選ぶカード が `[data-theme="v8"]` の下で V8 の寸法・色に切り替わる
 *   - 「経路の札」「進みの棒」は V8 と値が同じ（または v8対応済みの
 *     状態の札に委譲）なので、台帳に v8Same の印を付けて数える
 *   - v7 の見た目は変えない（全部 v8 セレクタの下）
 *
 * 値の出どころは Pencil ★V8 と lh-work/design/v8/COMPONENT-MAP.md の
 * オーナー決まり（表の寸法・数の帯の大きさ・箱の中に箱を作らない）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { collectReport } from '../../scripts/theme-migration-report.mjs'

const WEB = join(__dirname, '..', '..')
const SHARED = join(WEB, 'src/components/shared')
const css = (name: string) => readFileSync(join(SHARED, name), 'utf8')
const tsx = (name: string) => readFileSync(join(SHARED, name), 'utf8')

/** ある部品ファイルの v8 ブロック（全部まとめた文字列）を返す。 */
function v8Blocks(source: string, file: string) {
  const blocks = [...source.matchAll(/\[data-theme=["']?v8["']?\][^{]*\{([^}]*)\}/g)]
  expect(blocks.length, `${file} に [data-theme="v8"] の規定が無い`).toBeGreaterThan(0)
  return blocks.map((b) => b[1]).join('\n')
}

describe('V8 移行④b — 一覧まわり', () => {
  it('板の頭：題は 20px（text-title）・説明は 13px ink-secondary', () => {
    const blocks = v8Blocks(css('page-header.module.css'), 'page-header')
    expect(blocks).toContain('font-size: var(--text-title)')
    expect(blocks).toContain('font-size: var(--text-label)')
    expect(blocks).toContain('color: var(--color-ink-secondary)')
  })

  it('表の見出し：高さ44・地 table-head・上下に細い線・文字12/500', () => {
    const blocks = v8Blocks(css('table.module.css'), 'table')
    expect(blocks).toContain('height: 44px')
    expect(blocks).toContain('background: var(--color-table-head)')
    expect(blocks).toContain('border-top: 1px solid var(--color-divider)')
    expect(blocks).toContain('font-weight: 500')
  })

  it('表の行と外枠：行 52・左右20・区切りは divider・カード枠をやめる', () => {
    const blocks = v8Blocks(css('data-table.module.css'), 'data-table')
    expect(blocks).toContain('height: 52px')
    expect(blocks).toContain('padding: 9px 20px')
    expect(blocks).toContain('border-top: 1px solid var(--color-divider)')
    expect(blocks).toContain('border: 0')
    // 名前は 13px/500、補足は 12px ink-faint
    expect(blocks).toContain('font-size: var(--text-label)')
    expect(blocks).toContain('font-size: var(--text-caption)')
  })

  it('道具の1段：段と段の間は 12', () => {
    const blocks = v8Blocks(css('list-toolbar.module.css'), 'list-toolbar')
    expect(blocks).toContain('gap: 12px')
  })

  it('ページ送り：高さ36・数字のマスは 36×36', () => {
    const blocks = v8Blocks(css('pagination.module.css'), 'pagination')
    expect(blocks).toContain('height: 36px')
    expect(blocks).toContain('width: 36px')
  })

  it('数の帯：4枚のカードではなく1本の帯を縦線で割る（data-kpi-strip）', () => {
    expect(tsx('list-kpis.tsx')).toContain('kpiStyles.strip')
    const blocks = v8Blocks(css('kpi-card.module.css'), 'kpi-card')
    expect(blocks).toContain('border-left: 1px solid var(--color-divider)')
    expect(blocks).toContain('border-radius: 0')
    expect(blocks).toContain('box-shadow: none')
  })

  it('選ぶカード：余白 14・選ぶと枠 1.5px の濃い緑', () => {
    const blocks = v8Blocks(css('radio-card.module.css'), 'radio-card')
    expect(blocks).toContain('padding: 14px')
    expect(blocks).toContain('border-width: 1.5px')
    expect(blocks).toContain('border-color: var(--color-accent-deep)')
  })

  it('ダイアログ：大きさは 800/560・余白24・下から8px浮き出して入る', () => {
    const blocks = v8Blocks(css('dialog.module.css'), 'dialog')
    expect(blocks).toContain('width: min(800px, 100%)')
    expect(blocks).toContain('width: min(560px, 100%)')
    expect(blocks).toContain('padding: 24px')
    expect(css('dialog.module.css')).toContain('@keyframes dialog-v8-enter')
    expect(blocks).toContain('var(--motion-base)')
  })

  it('知らせ：下から 8px 浮き出しながら入る（200ms ease-out）', () => {
    const blocks = v8Blocks(css('toast.module.css'), 'toast')
    expect(blocks).toContain('animation: toast-v8-enter var(--motion-base) var(--motion-ease-out)')
    expect(css('toast.module.css')).toContain('@keyframes toast-v8-enter')
  })

  it('台帳がこの回の部品を v8対応済みと数える', { timeout: 60_000 }, () => {
    const report = collectReport()
    const done = ['板の頭', '表（見出し・行・横に送れる表）', '道具の1段', 'ページ送り', '数のマス・数の帯', '選ぶカード', '経路の札', '進みの棒', 'ダイアログ', '知らせ']
    for (const name of done) {
      const part = report.parts.find((p) => p.name === name)
      expect(part?.status, `${name} が v8対応済みになっていない`).toBe('v8対応済み')
    }
  })
})
