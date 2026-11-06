import { readUiSource as readFileSync } from '../../../../scripts/test-ui-source.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const CSS = readFileSync(new URL('./create-v8.module.css', import.meta.url), 'utf8')
const TSX = readFileSync(new URL('../../../v8/rich-menus/new/create.tsx', import.meta.url), 'utf8')
const FORM = readFileSync(
  join(HERE, '..', '..', '..', 'components', 'rich-menus', 'rich-menu-create-form.tsx'),
  'utf8',
)

/*
 * 面の分け方の共通部品・「画像の作り方」の窓・右の共通の要約・LINE の見え方は
 * v8/rich-menus/new/create-steps-react.test.tsx が描いて見る。
 * ここには、描画では測れない見た目の値と、自前の箱を画面に戻さない禁止の見張りだけを残す。
 */
function block(selector: string): string {
  const at = CSS.indexOf(selector)
  if (at < 0) throw new Error(`missing ${selector}`)
  return CSS.slice(at, CSS.indexOf('}', at))
}

describe('リッチメニュー作る①の形と画像（JeINq）', () => {
  it('案Aの面の分け方は共通部品に任せる（自前の見本の箱を置かない）', () => {
    expect(CSS).not.toContain('.layoutThumb {')
    // 面の見本は統括の例外時にもV8の共通フォームで使う。
    expect(FORM).toContain("fill: 'none'")
  })

  it('画像の文の間は8・合えば濃い緑・作り方は文字だけ', () => {
    expect(block('.imageMeta {')).toContain('gap: 8px')
    expect(block('.imageMetaOk {')).toContain('var(--color-accent-deep)')
    expect(block('.guideLink {')).toContain('background: transparent')
  })

  it('右の箱は共通部品（自前の題・行の指定は画面に置かない）', () => {
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
  })
})
