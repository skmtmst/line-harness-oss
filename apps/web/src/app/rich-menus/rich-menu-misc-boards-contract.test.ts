import { readUiSource as readFileSync } from '../../../scripts/test-ui-source.mjs'
import { describe, expect, it } from 'vitest'

const CREATE = readFileSync(new URL('../../v8/rich-menus/new/create.tsx', import.meta.url), 'utf8')
const CREATE_CSS = readFileSync(new URL('./new/create-v8.module.css', import.meta.url), 'utf8')

/*
 * 一覧の板ID（広い板・閲覧のみ・狭い板）と、狭い板でフォルダの列を畳むことは
 * v8/rich-menus/list-delete-import-react.test.tsx、作る4手順の板IDは
 * v8/rich-menus/new/create-steps-react.test.tsx が描いて見る。
 * ここには、古い板の印を戻さない禁止の見張りと、描画では測れない作る画面の畳みの CSS だけを残す。
 */
describe('リッチメニューの細かい板', () => {
  it('作る画面に古い板の印を戻さない', () => {
    expect(CREATE).not.toContain('data-design-node="rich-menu-create-v8"')
  })

  it('1152（Y9ASp・kmTab）は板1100px未満で畳む', () => {
    expect(CREATE_CSS).toContain('@container (max-width: 1100px)')
  })
})
