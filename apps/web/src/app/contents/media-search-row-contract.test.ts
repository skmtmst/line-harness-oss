import { readUiSource as readFileSync } from '../../../scripts/test-ui-source.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')

/*
 * 禁止の見張りだけを残す。検索・絞り込み・並べ替えの置き場と動きは
 * src/v8/contents/list-view.test.tsx（道具の段）が画面を描いて押して守る。
 */
describe('V8 登録メディアの検索と操作（禁止の見張り）', () => {
  it('検索を横いっぱいに伸ばさない（裸の全幅 input を置かない）', () => {
    expect(PAGE).not.toContain('data-search-row')
    expect(PAGE).not.toContain('type="search"')
    expect(PAGE).not.toMatch(/<SearchField[\s\S]*?className="w-full"/)
  })

  it('札の上にゴミ箱を直に置かない', () => {
    expect(PAGE).not.toContain('aria-label={`${item.filename}を削除`}')
  })
})
