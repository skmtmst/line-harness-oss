// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useStyleSetup } from './use-style-setup'

const api = vi.hoisted(() => ({ get: vi.fn(), warnings: vi.fn(), starterItems: vi.fn(), invalidate: vi.fn() }))
vi.mock('@/lib/api/helpers/styles', () => ({ styleApi: api }))
vi.mock('@/lib/api/transport/read-cache', () => ({ invalidateApiReads: api.invalidate }))
afterEach(() => { cleanup(); vi.resetAllMocks() })
function ready() {
  api.get.mockImplementation(async (id: string) => ({ success: true, data: { style: 'restaurant', version: 1, answers: {}, id } }))
  api.warnings.mockResolvedValue({ success: true, data: { items: [] } })
  api.starterItems.mockResolvedValue({ success: true, data: { items: [] } })
}
it('役割未取得では読まず、閲覧のみでは同じ既存GETを読む', async () => {
  ready()
  const view = renderHook(({ role }) => useStyleSetup('A', role), { initialProps: { role: null as string | null } })
  expect(view.result.current.status).toBe('idle')
  expect(api.get).not.toHaveBeenCalled()
  view.rerender({ role: 'viewer' })
  await waitFor(() => expect(view.result.current.status).toBe('ready'))
  expect(api.get).toHaveBeenCalledWith('A')
  expect(api.warnings).toHaveBeenCalledWith('A')
  expect(api.starterItems).toHaveBeenCalledWith('A')
})
it('管理者から閲覧のみへの切替で古い本文を使わず、読取キャッシュも消す', async () => {
  ready()
  const view = renderHook(({ role }) => useStyleSetup('A', role), { initialProps: { role: 'admin' } })
  await waitFor(() => expect(view.result.current.status).toBe('ready'))
  let resolve!: (value: unknown) => void
  api.starterItems.mockImplementationOnce(() => new Promise(done => { resolve = done }))
  view.rerender({ role: 'viewer' })
  expect(view.result.current.data).toBeNull()
  expect(api.invalidate).toHaveBeenCalledWith('/api/dashboard/style')
  await act(async () => resolve({ success: true, data: { items: [] } }))
  await waitFor(() => expect(view.result.current.status).toBe('ready'))
})
it('アカウントを切り替えた後に届いた古い結果を表示しない', async () => {
  ready()
  let resolve!: (value: unknown) => void
  api.get.mockImplementationOnce(() => new Promise(done => { resolve = done }))
  const view = renderHook(({ account }) => useStyleSetup(account, 'viewer'), { initialProps: { account: 'A' } })
  view.rerender({ account: 'B' })
  await waitFor(() => expect(view.result.current.status).toBe('ready'))
  const current = view.result.current.data
  await act(async () => resolve({ success: true, data: { style: 'standard', version: 0, answers: {} } }))
  expect(view.result.current.data).toBe(current)
})
it('403を未設定に変えず、再読込で同じ口を読み直す', async () => {
  ready()
  const error = Object.assign(new Error('forbidden'), { status: 403 })
  api.starterItems.mockRejectedValueOnce(error)
  const view = renderHook(() => useStyleSetup('A', 'viewer'))
  await waitFor(() => expect(view.result.current.status).toBe('error'))
  expect(view.result.current.error).toBe(error)
  expect(view.result.current.data).toBeNull()
  act(() => view.result.current.reload())
  await waitFor(() => expect(view.result.current.status).toBe('ready'))
  expect(api.starterItems).toHaveBeenCalledTimes(2)
})
