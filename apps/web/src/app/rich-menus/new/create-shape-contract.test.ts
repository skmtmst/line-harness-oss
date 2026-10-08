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

/* JeINq の画像設定と共通部品の利用を守る。形の操作はLayoutPickerの動作試験で確認する。 */
function block(selector: string): string {
  const at = CSS.indexOf(selector)
  if (at < 0) throw new Error(`missing ${selector}`)
  return CSS.slice(at, CSS.indexOf('}', at))
}

describe('リッチメニュー作る①の形と画像（JeINq）', () => {
  it('案Aの面の分け方は共通部品に任せる', () => {
    expect(TSX).toContain("from '@/components/shared/layout-picker'")
    expect(TSX).toContain('<LayoutPicker')
    expect(CSS).not.toContain('.layoutThumb {')
    // V7の見本は引き続き旧フォームで使う。
    expect(FORM).toContain("fill: 'none'")
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
