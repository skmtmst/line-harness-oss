import { readUiSource as readFileSync } from '../../../scripts/test-ui-source.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const EDIT = readFileSync(join(HERE, 'edit', 'page.tsx'), 'utf8')

/*
 * 状態・1152・閲覧のみの板は `data-design-node` が無いと
 * 進み具合に数えられない。見た目の部品は既存のものを使い、
 * ここでは板IDの結び付けだけを見る。
 *
 * 一覧（GrnO4・JV2oR）の見張りは、もう描かれない `list-v8.tsx` を読んでいたので
 * 2026-10-06 に外付けSSDの Archive/line-harness-tests-20261006 へ移した。
 * 新しい一覧（src/v8/forms/list.tsx）の閲覧のみ・1152 は src/v8/forms/list.test.tsx が描いて見る。
 */
describe('回答フォームの残りの板ID', () => {
  it('狭い幅で編集が ITBAB になる', () => {
    expect(EDIT).toContain("data-design-node={narrow ? 'ITBAB' : undefined}")
    expect(EDIT).toContain('useNarrowViewport()')
  })
})
