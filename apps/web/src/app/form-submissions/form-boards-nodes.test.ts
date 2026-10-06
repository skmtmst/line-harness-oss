import { readUiSource as readFileSync } from '../../../scripts/test-ui-source.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const LIST = readFileSync(join(HERE, 'list-v8.tsx'), 'utf8')
const EDIT = readFileSync(join(HERE, 'edit', 'page.tsx'), 'utf8')

/*
 * 状態・1152・閲覧のみの板は `data-design-node` が無いと
 * 進み具合に数えられない。見た目の部品は既存のものを使い、
 * ここでは板IDの結び付けだけを見る。
 */
describe('回答フォームの残りの板ID', () => {
  it('狭い幅で一覧が GrnO4 になる', () => {
    expect(LIST).toContain("data-design-node={narrow ? 'GrnO4' : 'I3L41O'}")
    expect(LIST).toContain('useNarrowViewport()')
  })

  it('見るだけの人に JV2oR の帯が出る', () => {
    expect(LIST).toContain('data-design-node="JV2oR"')
    expect(LIST).toContain('閲覧のみで見ています')
    // 帯は見るだけのときだけ。箱の操作と同じ canManageFolders が担う。
    expect(LIST).toContain('{!canManageFolders && (')
  })

  it('狭い幅で編集が ITBAB になる', () => {
    expect(EDIT).toContain("data-design-node={narrow ? 'ITBAB' : undefined}")
    expect(EDIT).toContain('useNarrowViewport()')
  })
})
