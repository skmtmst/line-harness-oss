import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const CSS = readFileSync(join(HERE, 'create-v8.module.css'), 'utf8')
const TSX = readFileSync(join(HERE, 'create-v8.tsx'), 'utf8')
const FORM = readFileSync(
  join(HERE, '..', '..', '..', 'components', 'rich-menus', 'rich-menu-create-form.tsx'),
  'utf8',
)

/**
 * 板 `JeINq`（リッチメニュー 作る① 形と画像）。
 * 絵の HTML の数値どおり：面の分け方の7つを横に広げ、見本は 64×44 の
 * 薄い地・選んだ見本は薄い緑＋濃い緑の線、面は塗らず薄い線だけ、
 * 画像の文の間は 8・大きさが合えば濃い緑、「画像の作り方」は文字だけ。
 */
function block(selector: string): string {
  const at = CSS.indexOf(selector)
  if (at < 0) throw new Error(`missing ${selector}`)
  return CSS.slice(at, CSS.indexOf('}', at))
}

describe('リッチメニュー作る①の形と画像（JeINq）', () => {
  it('面の分け方は横に広げ、見本は64×44の薄い地', () => {
    expect(block('.layoutGrid {')).toContain('display: flex')
    const thumb = block('.layoutThumb {')
    expect(thumb).toContain('width: 64px')
    expect(thumb).toContain('height: 44px')
    expect(thumb).toContain('var(--color-surface-pearl)')
  })

  it('選んだ見本は薄い緑＋濃い緑の線、名は絵どおり付ける', () => {
    const on = block('.layoutItemOn .layoutThumb {')
    expect(on).toContain('var(--color-accent-soft)')
    expect(on).toContain('var(--color-accent-deep)')
    expect(TSX).toContain('styles.layoutName')
    expect(TSX).toContain('aria-label={V8_LAYOUT_LABEL[item.key]')
  })

  it('見本の面は塗らず薄い線だけ（記号は残す）', () => {
    expect(FORM).toContain("fill: 'none'")
    expect(TSX).toContain('RichMenuTemplatePreview')
  })

  it('画像の文の間は8・合えば濃い緑・作り方は文字だけ', () => {
    expect(block('.imageMeta {')).toContain('gap: 8px')
    expect(block('.imageMetaOk {')).toContain('var(--color-accent-deep)')
    expect(block('.guideLink {')).toContain('background: transparent')
    expect(TSX).toContain('画像の作り方（大きさ・押しやすい余白）')
  })

  it('右の箱は共通部品（自前の題・行の指定は画面に置かない）', () => {
    expect(TSX).toContain("from '@/components/templates/create-parts'")
    expect(TSX).toContain('<CreateSummaryCard')
    expect(TSX).not.toContain('styles.railTitle')
    expect(TSX).not.toContain('styles.summaryList')
    expect(TSX).not.toContain('styles.summaryRow')
    expect(TSX).not.toContain('styles.factList')
    expect(CSS).not.toContain('.railTitle {')
    expect(CSS).not.toContain('.summaryList {')
    expect(CSS).not.toContain('.factList {')
  })

  it('見え方の題の行の行き先は部品に任せる（題を二重にしない）', () => {
    expect(TSX).not.toContain('styles.railGoLink')
    expect(TSX).toContain('<LinePreview')
  })
})
