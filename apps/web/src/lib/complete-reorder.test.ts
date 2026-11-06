import { expect, it, vi } from 'vitest'
import { completeReorder } from './complete-reorder'
it('ページ外の位置を保って全順位を送る', async () => {
  const load = vi.fn(async ({ page }: { page: number }) => ({ items: (page === 1 ? ['a', 'b'] : ['c', 'd']).map(id => ({ id })), total: 4, limit: 2, sort: [] }))
  expect(await completeReorder(['d', 'c'], load)).toEqual(['a', 'b', 'd', 'c'])
  expect(load).toHaveBeenCalledTimes(2)
})
it('取得途中に範囲が変わったら部分順位を返さない', async () => {
  const load = vi.fn(async ({ page }: { page: number }) => ({ items: [{ id: page === 1 ? 'a' : 'b' }], total: page === 1 ? 2 : 3, limit: 1, sort: [] }))
  await expect(completeReorder(['a'], load)).rejects.toThrow('一覧が変わりました')
})
it('重複・消えた行・サーバー上限超えでは保存しない', async () => {
  const load = async () => ({ items: [{ id: 'a' }, { id: 'b' }], total: 2, limit: 2, sort: [] })
  await expect(completeReorder(['a', 'a'], load)).rejects.toThrow()
  await expect(completeReorder(['missing'], load)).rejects.toThrow()
  await expect(completeReorder(['a'], load, 1)).rejects.toThrow()
})
