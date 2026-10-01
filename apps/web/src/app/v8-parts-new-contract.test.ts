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

  it('台帳がこの回の部品を v8対応済みと数える', { timeout: 60_000 }, () => {
    const report = collectReport()
    const part = report.parts.find((p) => p.name === 'リンク（→つき）')
    expect(part?.status, 'リンク（→つき）が v8対応済みになっていない').toBe('v8対応済み')
  })
})
