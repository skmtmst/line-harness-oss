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
    expect(count).toBe(3)
    expect(LIST).toContain('reminderList.loading && reminders.length === 0')
    expect(LIST).toContain('<DelayedSkeleton loading skeleton={loadingSkeleton} />')
    expect(LIST).toContain('onClick={reminderList.retry}')
    expect(LIST).toContain('条件を外す')
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
    expect(EDIT).toContain('data-design-node="k32cn"')
    expect(EDIT).toContain('違いを比べる')
    expect(EDIT).toContain('最新を読み込んで続ける')
    expect(EDIT).toContain('describeReminderDiff')
  })
})
