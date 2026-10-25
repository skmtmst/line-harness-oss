import { readUiSource } from '../../../scripts/test-ui-source.mjs'
import { describe, expect, it } from 'vitest'

const NEW_PAGE = readUiSource(new URL('./new/page.tsx', import.meta.url), 'utf8')

/**
 * 作成画面の「使う場所」は実在するオブジェクトのIDだけを選べる。仮IDの固定候補へ戻さない禁止の見張り。
 * 送るID・作った行への戻り・分析のファネルへ渡す導線は描画の試験が守る
 * （v8/conversions/create.test.tsx・list.test.tsx、v8/analytics/funnel-preset-conversion.test.tsx）。
 */
describe('利用先は実IDだけを選べる', () => {
  it('仮IDの固定候補を置かない', () => {
    expect(NEW_PAGE).not.toContain('USAGE_CHOICES')
    expect(NEW_PAGE).not.toContain("refId: 'conversion-overview'")
    expect(NEW_PAGE).not.toContain("refId: 'purchase-followup'")
    expect(NEW_PAGE).not.toContain("refId: 'conversion-followup'")
  })
})
