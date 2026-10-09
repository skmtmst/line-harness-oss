import { expect, test, vi } from 'vitest'
import { collectListRows } from './collect-list-rows'
test('別ページも読み、途中の通信失敗では部分的な全件選択を返さない', async () => {
  const first = Array.from({ length: 100 }, (_, i) => ({ id: String(i) }))
  const load = vi.fn().mockResolvedValueOnce({ items: first, total: 101 }).mockResolvedValueOnce({ items: [{ id: '100' }], total: 101 })
  expect(await collectListRows(101, load)).toHaveLength(101)
  expect(load).toHaveBeenLastCalledWith(100, 100)
  const failed = vi.fn().mockResolvedValueOnce({ items: first, total: 101 }).mockRejectedValueOnce(new Error('offline'))
  await expect(collectListRows(101, failed)).rejects.toThrow('offline')
})
test('同じページを繰り返す口では打ち切り、全部選べたとは扱わない', async () => {
  await expect(collectListRows(2, async () => ({ items: [{ id: '1' }], total: 2 }))).rejects.toThrow('全件を読み込めませんでした')
})
