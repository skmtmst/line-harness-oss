import { expect, it } from 'vitest'
import { runCounts } from './run-counts'

it('全件表示ではAPIの集計を使い、0件と未取得を分ける', () => {
  expect(runCounts('all', 'all', 300, { failed: 0, returning: 50, testPending: null })).toEqual({ all: 300, failed: 0, returning: 50, pending: undefined })
  expect(runCounts('all', 'all', undefined, null)).toEqual({ all: undefined, failed: undefined, returning: undefined, pending: undefined })
})

it('失敗だけの集計から、すべて・再追加の全件数を作らない', () => {
  expect(runCounts('all', 'failed', 8, { failed: 8, returning: 2 })).toEqual({ all: undefined, failed: 8, returning: undefined, pending: undefined })
})

it('再追加だけ・複数条件の集計を他のタブへ流用しない', () => {
  expect(runCounts('returning', 'all', 50, { failed: 2, returning: 50 })).toEqual({ all: undefined, failed: undefined, returning: 50, pending: undefined })
  expect(runCounts('returning', 'failed', 2, { failed: 2, returning: 2 })).toEqual({ all: undefined, failed: undefined, returning: undefined, pending: undefined })
})
