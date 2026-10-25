import { readUiSource } from '../../../scripts/test-ui-source.mjs'
import { describe, expect, it } from 'vitest'

const PAGE = readUiSource(new URL('./page.tsx', import.meta.url), 'utf8')

/**
 * 成果地点一覧の禁止の見張り。続きの頁の読み足し・50頁での打ち切り・並びと探す言葉を口へ渡すこと・
 * 影響が読めないまま止めないこと・古い応答を捨てることは v8/conversions/list.test.tsx が描画して確かめる。
 */
describe('成果地点一覧の点検契約', () => {
  it('無制限の取得に戻さない', () => {
    expect(PAGE, '無制限の取得に戻っている').not.toContain('for (;;)')
  })

  it('画面で探し直さない', () => {
    expect(PAGE, '画面内で探し直している').not.toContain('p.name.includes(q)')
  })
})
