/*
 * ★V8 移行④「Pencil にあってコードに無かった部品」の固定。
 *
 *   - リンク（→つき）・切り替え（3つ）・増減の札・印のタイル・
 *     動きの印/動きの行・段の題・チェックのカード が
 *     Pencil の寸法どおりに shared/ にあること
 *   - これらは V8 で新たに生えた部品なので v7 側の見た目を持たない
 *     （台帳では v8Only として数える）
 *
 * 値の出どころは Pencil ★V8 の各部品（g5Db8 など）と
 * lh-work/design/v8/MOTION.md・COMPONENT-MAP.md。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { collectReport } from '../../scripts/theme-migration-report.mjs'

const WEB = join(__dirname, '..', '..')
const SHARED = join(WEB, 'src/components/shared')
const css = (name: string) => readFileSync(join(SHARED, name), 'utf8')

describe('V8 移行④ — Pencil にあってコードに無かった部品', () => {
  it('リンク（→つき g5Db8）：文字12/500・action・矢印が乗せると 2px 右へ（120ms）', () => {
    const source = css('text-link.module.css')
    expect(source).toContain('font-size: var(--text-caption)')
    expect(source).toContain('font-weight: 500')
    expect(source).toContain('color: var(--color-action)')
    expect(source).toContain('transform: translateX(2px)')
    expect(source).toContain('var(--motion-fast)')
    const tsx = readFileSync(join(SHARED, 'text-link.tsx'), 'utf8')
    expect(tsx).toContain('ArrowRight')
  })

  it('増減の札（C6DGX・OEQxt・r9qfM2）：余白 2/7・文字12/600・3色', () => {
    const source = css('delta-chip.module.css')
    expect(source).toContain('padding: 2px 7px')
    expect(source).toContain('border-radius: var(--radius-mini)')
    expect(source).toContain('font-size: var(--text-caption)')
    expect(source).toContain('font-weight: 600')
    expect(source).toContain('background: var(--color-success-bg)')
    expect(source).toContain('background: var(--color-status-danger-soft)')
    expect(source).toContain('background: var(--color-status-warn-soft)')
    const tsx = readFileSync(join(SHARED, 'delta-chip.tsx'), 'utf8')
    expect(tsx).toContain("'up' | 'down' | 'attention'")
  })

  it('印のタイル（C9CaMS・E7USZ9・A2mryd）：22/28/32・白地・hairline・角丸 7/9', () => {
    const source = css('icon-tile.module.css')
    expect(source).toContain('width: 22px')
    expect(source).toContain('width: 28px')
    expect(source).toContain('width: 32px')
    expect(source).toContain('background: var(--color-canvas)')
    expect(source).toContain('border: 1px solid var(--color-hairline)')
    expect(source).toContain('border-radius: var(--radius-tile-sm)')
    expect(source).toContain('border-radius: var(--radius-tile)')
    const tsx = readFileSync(join(SHARED, 'icon-tile.tsx'), 'utf8')
    expect(tsx).toContain("'sm' | 'md' | 'lg'")
  })

  it('動きの印・動きの行（x4FeKG・EsjP2）：印24丸・縦線1・題13/500・補足・時刻', () => {
    const source = css('activity-item.module.css')
    expect(source).toContain('width: 24px')
    expect(source).toContain('height: 24px')
    expect(source).toContain('border-radius: var(--radius-pill)')
    expect(source).toContain('background: var(--color-shell)')
    expect(source).toContain('width: 1px')
    expect(source).toContain('background: var(--color-hairline)')
    expect(source).toContain('font-size: var(--text-label)')
    expect(source).toContain('font-weight: 500')
    expect(source).toContain('color: var(--color-ink-faint)')
    const tsx = readFileSync(join(SHARED, 'activity-item.tsx'), 'utf8')
    expect(tsx).toContain('last')
  })

  it('段の題（CugIm）：題15/600・補足12・「？」と右端の行き先リンク', () => {
    const source = css('section-header.module.css')
    expect(source).toContain('font-size: 15px')
    expect(source).toContain('font-weight: 600')
    expect(source).toContain('color: var(--color-ink)')
    expect(source).toContain('gap: 6px')
    expect(source).toContain('margin-left: auto')
    const tsx = readFileSync(join(SHARED, 'section-header.tsx'), 'utf8')
    expect(tsx).toContain('HelpTip')
    expect(tsx).toContain('TextLink')
  })

  it('チェックのカード（w6uYMd・RRxK5）：高68・余白14・オンで緑の地と描かれるチェック', () => {
    const source = css('check-card.module.css')
    expect(source).toContain('min-height: 68px')
    expect(source).toContain('padding: 14px')
    expect(source).toContain('gap: 12px')
    expect(source).toContain('border-radius: var(--radius-card)')
    expect(source).toContain('background: var(--color-accent-soft)')
    expect(source).toContain('border-color: var(--color-accent-deep)')
    expect(source).toContain('width: 18px')
    expect(source).toContain('stroke-dashoffset')
    const tsx = readFileSync(join(SHARED, 'check-card.tsx'), 'utf8')
    expect(tsx).toContain('type="checkbox"')
  })

  it('切り替え（3つ dtJVi）：器shell・余白3・間隔2・白いつまみが滑る（120ms）・左右キー', () => {
    const source = css('segmented.module.css')
    expect(source).toContain('padding: 2px')
    expect(source).toContain('gap: 2px')
    expect(source).toContain('border-radius: var(--radius-control)')
    expect(source).toContain('background: var(--color-shell)')
    expect(source).toContain('background: var(--color-canvas)')
    expect(source).toContain('border-radius: var(--radius-segment)')
    expect(source).toContain('padding: 6px 12px')
    expect(source).toContain('font-size: var(--text-label)')
    expect(source).toContain('font-weight: 600')
    expect(source).toContain('line-height: 1.5')
    expect(source).toContain('var(--motion-fast)')
    const tsx = readFileSync(join(SHARED, 'segmented.tsx'), 'utf8')
    expect(tsx).toContain('role="group"')
    expect(tsx).toContain('aria-pressed')
    expect(tsx).toContain('ArrowLeft')
    expect(tsx).toContain('ArrowRight')
    expect(tsx).toContain('ResizeObserver')
  })

  it('台帳がこの回の部品を v8対応済みと数える', { timeout: 60_000 }, () => {
    const report = collectReport()
    for (const name of ['リンク（→つき）', '増減の札', '印のタイル', '動きの印・動きの行', '段の題', 'チェックのカード', '切り替え（3つ）']) {
      const part = report.parts.find((p) => p.name === name)
      expect(part?.status, `${name} が v8対応済みになっていない`).toBe('v8対応済み')
    }
  })
})
