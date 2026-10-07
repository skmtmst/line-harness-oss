import { readUiSource as readFileSync } from '../../../scripts/test-ui-source.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const LIST = readFileSync(join(HERE, 'list-v8.tsx'), 'utf8')
const EDIT = readFileSync(join(HERE, 'edit', 'edit-v8.tsx'), 'utf8')

/*
 * 状態・1152・閲覧のみ・競合の板は `data-design-node` が無いと
 * 進み具合に数えられない。見た目の部品は既存のものを使い、
 * ここでは板IDの結び付けだけを見る。
 */
describe('リマインダの残りの板ID', () => {
  it('失敗・絞り込み0件・未作成にRrYYJ、読込中はスケルトンを出す', () => {
    const count = LIST.split('data-design-node="RrYYJ"').length - 1
    // 絞り込み0件・未作成は空の一覧の共通部品1つ（修正案 D-2）に寄せた。失敗と合わせて2か所。
    expect(count).toBe(2)
    expect(LIST).toContain('reminderList.loading && reminders.length === 0')
    expect(LIST).toContain('<DelayedSkeleton loading skeleton={loadingSkeleton} />')
    expect(LIST).toContain('onClick={reminderList.retry}')
    // 「条件を外す」は共通部品が出す。ここでは外す口を渡していることを見る。
    expect(LIST).toContain('onClearFilters={() => {')
  })

  it('見るだけの人に a5C1p の帯が出る', () => {
    expect(LIST).toContain('data-design-node="a5C1p"')
    expect(LIST).toContain('閲覧のみで見ています')
    expect(LIST).toContain('{role !== null && !canEdit && (')
  })

  it('狭い幅で一覧が Iffil になる', () => {
    expect(LIST).toContain("boardId={narrow ? 'Iffil' : 'apLqS'}")
    expect(LIST).toContain('useNarrowViewport()')
  })

  it('編集の競合に k32cn の帯と比較み・読み込みが出る', () => {
    // 帯・比べる窓は共通の save-conflict（動きの点検 16 番）。押した動きは reminder-save-conflict.react.test.tsx。
    expect(EDIT).toMatch(/<SaveConflictBand\s+designNode="k32cn"/)
    expect(EDIT).toContain('onCompare={() => void saveConflict.compare()}')
    expect(EDIT).toContain('onReload={() => void saveConflict.reloadLatest()}')
    expect(EDIT).toContain('<SaveConflictCompareDialog')
    expect(EDIT).toContain('describeReminderDiff')
  })
})
