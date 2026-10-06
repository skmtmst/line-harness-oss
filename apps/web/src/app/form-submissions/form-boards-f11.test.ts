import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const MENU = readFileSync(
  join(HERE, '..', '..', 'components', 'forms', 'block-editor.tsx'),
  'utf8',
)
const EDIT_PAGE = readFileSync(join(HERE, 'edit', 'page.tsx'), 'utf8')
const EDITOR = readFileSync(
  join(HERE, '..', '..', 'components', 'forms', 'block-editor.tsx'),
  'utf8',
)

/*
 * F11 5段階評価・住所（板 `WOPjZ`）。共有の型・検証・保存は対応済みなので、
 * ここでは足す口・見本・板IDの結び付けだけを見る。
 */
describe('F11 5段階評価・住所の板', () => {
  it('足す口に5段階評価と住所がある', () => {
    expect(MENU).toContain("{ kind: 'input', type: 'rating', label: '5段階評価', group: '入力' }")
    expect(MENU).toContain("{ kind: 'input', type: 'address', label: '住所', group: '入力' }")
  })

  it('足す口に WOPjZ の板IDが付く', () => {
    expect(EDIT_PAGE).toContain('data-design-node="WOPjZ"')
  })

  it('足す口に予約を入れるがあり、設定に ijxur の板IDが付く', () => {
    expect(MENU).toContain("{ kind: 'input', type: 'booking', label: '予約を入れる', group: '入力' }")
    expect(EDITOR).toContain('data-design-node="ijxur"')
    expect(EDITOR).toContain('予約メニュー')
  })
})
