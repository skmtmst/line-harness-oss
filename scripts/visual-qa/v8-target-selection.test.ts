import { describe, expect, it } from 'vitest'
// @ts-expect-error JS tool
import { selectTargets } from './v8-parity-all.mjs'
const map = { boards: { list: { route: '/tags', url: '/tags?tab=fields', width: 1440 }, settings: { route: '/settings', url: '/settings?tab=profile', width: 1152 } } }

describe('ROOT-05 query付きの板', () => {
  it('実装のある入口を対象に含め、渡されたタブ指定を残す', () => {
    const ids = ['list', 'settings']
    const { targets, skipped } = selectTargets(map, { onlyBoards: ids })
    expect(skipped).toEqual([])
    expect(targets.map((t: { board: string; route: string }) => [t.board, t.route])).toEqual(
      ids.sort().map(id => [id, (map.boards[id as keyof typeof map.boards] as { url?: string }).url]))
  })
  it('存在しない入口と幅なしの板は外す', () => {
    const boards = { absent: { route: '/not-implemented', width: 1440 }, liff: { route: '/tags', width: null } }
    expect(selectTargets({ boards }).targets).toEqual([])
    expect(selectTargets({ boards }).skipped).toHaveLength(2)
  })
})
