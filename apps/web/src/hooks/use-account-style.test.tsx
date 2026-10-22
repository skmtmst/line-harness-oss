// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useAccountStyle, accountStyleUpdated } from './use-account-style'
const net = vi.hoisted(() => ({ get: vi.fn() }))
beforeEach(() => {
  localStorage.setItem('lh_csrf', 'fixture-session')
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(await net.get(new URL(url).searchParams.get('account_id'))))))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
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

it('本文で読み直すと、同じアカウントの左メニューも一緒に復旧する', async () => {
  net.get.mockReset().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(ok('lesson'))
  const view = renderHook(() => ({ menu: useAccountStyle('shared'), body: useAccountStyle('shared') }))
  await waitFor(() => expect(view.result.current.menu.status).toBe('error'))
  expect(view.result.current.body.status).toBe('error')
  expect(net.get).toHaveBeenCalledTimes(1)
  act(view.result.current.body.reload)
  await waitFor(() => expect(view.result.current.menu.data?.style).toBe('lesson'))
  expect(view.result.current.body.data?.style).toBe('lesson')
  expect(net.get).toHaveBeenCalledTimes(2)
})

it('保存前に始めた遅い読み取りを切り離し、保存後の業種を本文とメニューで共有する', async () => {
  let resolveOld!: (value: unknown) => void
  net.get.mockReset().mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve })).mockResolvedValue(ok('consult'))
  const view = renderHook(() => ({ menu: useAccountStyle('saving'), body: useAccountStyle('saving') }))
  await waitFor(() => expect(net.get).toHaveBeenCalledTimes(1))
  act(() => accountStyleUpdated('saving'))
  await waitFor(() => expect(view.result.current.menu.data?.style).toBe('consult'))
  expect(view.result.current.body.data?.style).toBe('consult')
  expect(net.get).toHaveBeenCalledTimes(2)
  await act(async () => resolveOld(ok('restaurant')))
  expect(view.result.current.menu.data?.style).toBe('consult')
  expect(view.result.current.body.data?.style).toBe('consult')
})
