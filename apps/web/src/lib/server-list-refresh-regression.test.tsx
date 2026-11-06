// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, expect, it, vi } from 'vitest'
import { ApiError } from './api'
import { useCursorServerList, useOffsetServerList } from './use-server-list'
afterEach(cleanup)
const answer = { items: ['残す行'], total: 1, limit: 50, sort: [] }
it('カーソル一覧は条件変更時に旧行を隠してから新しい行を出す', async () => {
  let resolve!: (value: typeof answer) => void
  const load = vi.fn().mockResolvedValueOnce(answer).mockImplementationOnce(() => new Promise(r => { resolve = r }))
  const view = renderHook(({ key }) => useCursorServerList({ requestKey: key, load }), { initialProps: { key: 'a' } })
  await waitFor(() => expect(view.result.current.items).toEqual(['残す行']))
  view.rerender({ key: 'b' })
  expect(view.result.current.items).toEqual([])
  expect(view.result.current.loading).toBe(true)
  await act(async () => resolve({ ...answer, items: ['新しい行'] }))
  expect(view.result.current.items).toEqual(['新しい行'])
})
it('読み直しが通信失敗しても取得済みの行を残す', async () => {
  const load = vi.fn().mockResolvedValueOnce(answer).mockRejectedValueOnce(new Error('network'))
  const view = renderHook(() => useOffsetServerList({ requestKey: 'a', load }))
  await waitFor(() => expect(view.result.current.loaded).toBe(true))
  act(() => view.result.current.retry())
  await waitFor(() => expect(view.result.current.error?.message).toBe('network'))
  expect(view.result.current.items).toEqual(['残す行'])
  expect(view.result.current.stateView).not.toBeNull()
})
it('権限を失ったときは取得済みの行を隠す', async () => {
  const load = vi.fn().mockResolvedValueOnce(answer).mockRejectedValueOnce(new ApiError(403, 'forbidden'))
  const view = renderHook(() => useOffsetServerList({ requestKey: 'a', load }))
  await waitFor(() => expect(view.result.current.loaded).toBe(true))
  act(() => view.result.current.retry())
  await waitFor(() => expect(view.result.current.error).not.toBeNull())
  expect(view.result.current.items).toEqual([])
})

it('取得済み0件の同条件更新でも、空の状態を消さずに更新中にする', async () => {
  let finish!: (value: typeof answer) => void
  const load = vi.fn().mockResolvedValueOnce({ ...answer, items: [] }).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const view = renderHook(() => useOffsetServerList({ requestKey: 'a', load }))
  await waitFor(() => expect(view.result.current.loaded).toBe(true))
  act(() => view.result.current.retry())
  expect(view.result.current.refreshing).toBe(true)
  expect(renderToStaticMarkup(view.result.current.stateView)).toContain('data-list-state="empty"')
  await act(async () => finish(answer))
  expect(view.result.current.items).toEqual(['残す行'])
})

it.each([useOffsetServerList<string>, useCursorServerList<string>])('取得済みの行は同条件の読み直しで残し、refreshingを返す: %s', async useList => {
  let finish!: (value: typeof answer) => void
  const load = vi.fn().mockResolvedValueOnce(answer).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const view = renderHook(() => useList({ requestKey: 'a', load }))
  await waitFor(() => expect(view.result.current.items).toEqual(answer.items))
  act(() => view.result.current.retry())
  expect(view.result.current.refreshing).toBe(true)
  expect(view.result.current.items).toEqual(answer.items)
  expect(view.result.current.total).toBe(1)
  expect(view.result.current.stateView).toBeNull()
  await act(async () => finish({ ...answer, items: ['更新された行'] }))
  expect(view.result.current.items).toEqual(['更新された行'])
  expect(view.result.current.refreshing).toBe(false)
})
