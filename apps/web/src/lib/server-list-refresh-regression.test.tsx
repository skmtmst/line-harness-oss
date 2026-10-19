// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ApiError } from './api'
import { useCursorServerList, useOffsetServerList } from './use-server-list'
afterEach(cleanup)
const answer = { items: ['残す行'], total: 1, limit: 50, sort: [] }
it('B-12: カーソル一覧は条件変更と再取得で前の行を消さない', async () => {
  let resolve!: (value: typeof answer) => void
  const load = vi.fn().mockResolvedValueOnce(answer).mockImplementationOnce(() => new Promise(r => { resolve = r }))
  const view = renderHook(({ key }) => useCursorServerList({ requestKey: key, load }), { initialProps: { key: 'a' } })
  await waitFor(() => expect(view.result.current.items).toEqual(['残す行']))
  view.rerender({ key: 'b' })
  expect(view.result.current.items).toEqual(['残す行'])
  expect(view.result.current.loading).toBe(true)
  await act(async () => resolve({ ...answer, items: ['新しい行'] }))
  expect(view.result.current.items).toEqual(['新しい行'])
})
it('B-12: 読み直しが通信失敗しても取得済みの行を残す', async () => {
  const load = vi.fn().mockResolvedValueOnce(answer).mockRejectedValueOnce(new Error('network'))
  const view = renderHook(() => useOffsetServerList({ requestKey: 'a', load }))
  await waitFor(() => expect(view.result.current.loaded).toBe(true))
  act(() => view.result.current.retry())
  await waitFor(() => expect(view.result.current.error?.message).toBe('network'))
  expect(view.result.current.items).toEqual(['残す行'])
  expect(view.result.current.stateView).not.toBeNull()
})
it('B-12: 権限を失ったときは取得済みの行を隠す', async () => {
  const load = vi.fn().mockResolvedValueOnce(answer).mockRejectedValueOnce(new ApiError(403, 'forbidden'))
  const view = renderHook(() => useOffsetServerList({ requestKey: 'a', load }))
  await waitFor(() => expect(view.result.current.loaded).toBe(true))
  act(() => view.result.current.retry())
  await waitFor(() => expect(view.result.current.error).not.toBeNull())
  expect(view.result.current.items).toEqual([])
})
