// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useAccountStyle, accountStyleUpdated } from './use-account-style'
const net = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('@/lib/api-styles', () => ({ styleApi: net }))
afterEach(cleanup)
const ok = (style: string) => ({ success: true, data: { style } })
it('切替の最初の描画から別店の業種を返さず、遅い前の返事も使わない', async () => {
  let resolveOld!: (value: unknown) => void
  net.get.mockImplementation(id => id === 'old' ? new Promise(resolve => { resolveOld = resolve }) : Promise.resolve(ok('ec')))
  const view = renderHook(({ id }) => useAccountStyle(id), { initialProps: { id: 'old' } })
  await waitFor(() => expect(net.get).toHaveBeenCalledWith('old'))
  view.rerender({ id: 'new' })
  expect(view.result.current.data).toBeNull()
  await waitFor(() => expect(view.result.current.data?.style).toBe('ec'))
  await act(async () => resolveOld(ok('restaurant')))
  expect(view.result.current.data?.style).toBe('ec')
})
it('失敗と不正な業種を標準へ読み替えず、再試行と同じ店の保存通知で読み直す', async () => {
  net.get.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(ok('meeting')).mockResolvedValueOnce(ok('consult')).mockResolvedValue(ok('salon'))
  const view = renderHook(() => useAccountStyle('a'))
  await waitFor(() => expect(view.result.current.status).toBe('error'))
  act(view.result.current.reload)
  await waitFor(() => expect(net.get).toHaveBeenCalledTimes(2))
  await waitFor(() => expect(view.result.current.status).toBe('error'))
  expect(view.result.current.data).toBeNull()
  act(view.result.current.reload)
  await waitFor(() => expect(view.result.current.data?.style).toBe('consult'))
  act(() => accountStyleUpdated('b'))
  expect(view.result.current.data?.style).toBe('consult')
  act(() => accountStyleUpdated('a'))
  await waitFor(() => expect(view.result.current.data?.style).toBe('salon'))
})
