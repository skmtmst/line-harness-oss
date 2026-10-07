import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const LIST = readFileSync(join(HERE, 'list-v8.tsx'), 'utf8')
const TAB = readFileSync(join(HERE, 'tags-tab-v8.tsx'), 'utf8')
const EDITOR = readFileSync(join(HERE, 'tag-editor-v8.tsx'), 'utf8')
const EDIT = readFileSync(join(HERE, 'edit-tag-page-v8.tsx'), 'utf8')

/*
 * 状態・1152・閲覧のみ・競合の板は `data-design-node` が無いと
 * 進み具合に数えられない。見た目の部品は既存のものを使い、
 * ここでは板IDの結び付けだけを見る。
 */
describe('友だち属性の残りの板ID', () => {
  it('状態の4場面に U0aKD が付く', () => {
    // 読み込み場面は共通の骨組み（TagRowsSkeleton）に designNode で渡す。
    // 注釈の `U0aKD` を除き、札の値を4つ数える。
    const count = (TAB.match(/(?<!`)U0aKD(?!`)/g) ?? []).length
    expect(count).toBe(4)
  })

  it('狭い幅で一覧が aPeD8 になる', () => {
    expect(LIST).toContain("data-design-node={narrow ? 'aPeD8' : 'I1E7Bt'}")
    expect(LIST).toContain('useNarrowViewport()')
  })

  it('タグの編集を見るだけの人に fkGUR の帯が出て操作が止まる', () => {
    expect(EDIT).toContain('data-design-node="fkGUR"')
    expect(EDIT).toContain('閲覧のみで見ています')
    expect(EDIT).toContain('readOnly={!canEdit}')
    expect(EDITOR).toContain('readOnly')
    expect(EDITOR).toContain('<fieldset disabled={readOnly}')
  })

  it('タグの編集の競合に xn95q の帯と比較み・読み込みが出る', () => {
    // 帯・比べる窓は共通の save-conflict に寄せた（2026-10-07）。文言・ボタンは共通部品が持つ。
    expect(EDIT).toMatch(/<SaveConflictBand[\s\S]{0,200}designNode="xn95q"/)
    expect(EDIT).toContain('onCompare={() => void openCompare()}')
    expect(EDIT).toContain('<SaveConflictCompareDialog')
    expect(EDIT).toContain('describeTagDiff')
  })
})
