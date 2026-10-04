import { readUiSource as readFileSync } from '../../../scripts/test-ui-source.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const LIST = readFileSync(join(HERE, 'list-v8.tsx'), 'utf8')
const LIST_CSS = readFileSync(join(HERE, 'list-v8.module.css'), 'utf8')
const DETAIL = readFileSync(join(HERE, 'detail', 'detail-v8.tsx'), 'utf8')
const FIRST_CSS = readFileSync(join(HERE, 'first-step-v8.module.css'), 'utf8')

/*
 * V8 シナリオ配信の細かい板（X0QrW0・kz2B6・wjfLe・U5rxyH）。
 * 一覧の閲覧のみは同じ画面の状態として板IDを付け、
 * 編集の競合は帯で知らせて書き換えない。
 * 1152は板1100px未満で畳む（同一画面の幅違い）。v7 は変えない。
 */
describe('シナリオ配信の細かい板', () => {
  it('一覧の閲覧のみに板IDを付ける（X0QrW0）', () => {
    expect(LIST).toContain("data-design-node={canEdit ? 'axFrW' : 'X0QrW0'}")
  })

  it('一覧1152（wjfLe）は板1100px未満で畳む', () => {
    expect(LIST_CSS).toContain('@container (max-width: 1099px)')
  })

  it('編集の競合は帯・比べる・読み直しを出す（kz2B6）', () => {
    expect(DETAIL).toContain('data-design-node="kz2B6"')
    expect(DETAIL).toContain('ほかの人がこのシナリオを更新しました')
    expect(DETAIL).toContain('違いを比べる')
    expect(DETAIL).toContain('最新を読み込んで続ける')
    expect(DETAIL).toContain('比べてから保存')
  })

  it('作る②の1152（U5rxyH）は狭い板で右の欄を下へ畳む', () => {
    expect(FIRST_CSS).toContain('@media (max-width: 1352px)')
  })
})
