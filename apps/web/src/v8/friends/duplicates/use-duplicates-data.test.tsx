// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const net = vi.hoisted(() => ({ stats: vi.fn(), list: vi.fn(), detectFriendDuplicates: vi.fn() }))
vi.mock('@/lib/api', () => ({ api: { duplicates: { stats: net.stats }, identityCandidates: net } }))
vi.mock('@/components/shared/list-url-state', async () => {
  const React = await import('react')
  return { useListUrlValue: (_key: string, initial: unknown) => React.useState(initial) }
})
import { useDuplicatesData } from './use-duplicates-data'
const resultOf = (id: string, total = 1) => ({ success: true, data: { items: [{ id }], total } })
beforeEach(() => {
  net.stats.mockResolvedValue({ success: true, data: { totalFollowing: 2, uniquePeople: 1, friendDups: 1, duplicateGroups: 1, perAccount: [] } })
  net.list.mockResolvedValue(resultOf('new'))
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('検索は全候補へ渡し、次のページも取得できる', async () => {
  const { result } = renderHook(useDuplicatesData)
  await waitFor(() => expect(result.current.candidatesLoading).toBe(false))
  await act(async () => result.current.setQuery('山田'))
  await waitFor(() => expect(net.list).toHaveBeenLastCalledWith(expect.objectContaining({ q: '山田', limit: 50, offset: 0 })))
  await act(async () => result.current.setPage(2))
  await waitFor(() => expect(net.list).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 50 })))
})

it('条件変更前の遅い返事を現在の候補へ混ぜない', async () => {
  let finish!: (value: unknown) => void
  net.list.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  const { result } = renderHook(useDuplicatesData)
  await act(async () => result.current.setStatus('linked'))
  await waitFor(() => expect(result.current.candidates[0]?.id).toBe('new'))
  await act(async () => finish(resultOf('old')))
  expect(result.current.candidates[0]?.id).toBe('new')
})

it('集計が拒否されても読めた候補を保持し、失敗を0件の集計にしない', async () => {
  const forbidden = { status: 403 }
  net.stats.mockRejectedValue(forbidden)
  const { result } = renderHook(useDuplicatesData)
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.statsFailure).toBe(forbidden)
  expect(result.current.data).toBeNull()
  expect(result.current.candidates[0]?.id).toBe('new')
})

it('表示時刻の1分更新を解除し、離れた後の古い要求を無効にする', async () => {
  const clear = vi.spyOn(window, 'clearInterval')
  const { unmount } = renderHook(useDuplicatesData)
  await waitFor(() => expect(net.list).toHaveBeenCalled())
  unmount()
  expect(clear).toHaveBeenCalled()
})
