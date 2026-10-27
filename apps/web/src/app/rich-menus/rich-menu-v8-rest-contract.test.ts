import { readUiSource as readFileSync } from '../../../scripts/test-ui-source.mjs'
import { describe, expect, it } from 'vitest'

const CREATE = readFileSync(new URL('../../v8/rich-menus/new/create.tsx', import.meta.url), 'utf8')
const CREATE_CSS = readFileSync(new URL('./new/create-v8.module.css', import.meta.url), 'utf8')

/*
 * V8 リッチメニューの残り板。
 * 一覧の板の印（広い・狭い・閲覧のみ）と狭い板でフォルダの列を畳むことは src/v8/rich-menus/list-ops-react.test.tsx、
 * 作る4手順の板の印と編集の競合の帯は app/rich-menus/new/create-ops-react.test.tsx が画面を動かして見る。
 * ここには古い板の印の禁止と、描画では測れない作る画面の畳みの CSS だけを残す。
 */
describe('リッチメニューの残り板', () => {
  it('作る画面に古い板の印を戻さない', () => {
    expect(CREATE).not.toContain('data-design-node="rich-menu-create-v8"')
  })

  it('作る画面は板1100px未満で畳む', () => {
    expect(CREATE_CSS).toContain('@container (max-width: 1100px)')
  })
})
