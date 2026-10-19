import { readUiSource as readFileSync } from '../../../../../scripts/test-ui-source.mjs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('../../../../v8/nen-campaigns/column-new.tsx', import.meta.url), 'utf8')

// 管理画面のスマホでの並べ替えは廃止。V8でも保存の入口を残す。
describe('NENコラム作成の保存', () => {
  it('保存は下部追従バーに置いたまま', () => {
    expect(PAGE).toContain('footerActions={')
    expect(PAGE).toContain('下書きを保存')
  })
})
