import { expect, it, vi } from 'vitest'
import { friendReminderPage } from './friend-reminder-list'

it('E1：全ページを絞ってから切り、2ページ目にある登録も総数へ含める', async () => {
  const rows = Array.from({ length: 130 }, (_, i) => ({ id: `r-${i}` }))
  const load = vi.fn(async (page: number, limit: number) => ({ items: rows.slice((page - 1) * limit, page * limit), total: rows.length }))
  expect(await friendReminderPage(['r-5', 'r-110'], { page: 2, limit: 1 }, load)).toMatchObject({ items: [{ id: 'r-110' }], total: 2, limit: 1 })
  expect(load.mock.calls).toEqual([[1, 100], [2, 100]])
})
it('E1：登録なしは全員を出さず、後半の読込失敗も空へ変えない', async () => {
  const load = vi.fn().mockResolvedValueOnce({ items: Array.from({ length: 100 }, (_, i) => ({ id: `r-${i}` })), total: 130 }).mockRejectedValueOnce(new Error('後半の通信が失敗'))
  expect(await friendReminderPage([], { page: 1, limit: 20 }, load)).toMatchObject({ items: [], total: 0 })
  expect(load).not.toHaveBeenCalled()
  await expect(friendReminderPage(['r-110'], { page: 1, limit: 20 }, load)).rejects.toThrow('後半の通信が失敗')
})
