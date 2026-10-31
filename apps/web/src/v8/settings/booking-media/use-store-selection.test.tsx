// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { RestaurantStore } from '@/lib/restaurant-test-api'
import { deferred } from '@/test-utils/race'
const net = vi.hoisted(() => ({ list: vi.fn(), context: vi.fn(), select: vi.fn() }))
vi.mock('@/lib/restaurant-test-api', () => ({ restaurantTestApi: { listStores: net.list, storeContext: net.context, selectStore: net.select } }))
import { useBookingMediaStoreSelection } from './use-store-selection'
const store = (id: string, account = 'a', status: RestaurantStore['status'] = 'active') => ({ id, name: '同名の店', line_account_id: account, status } as RestaurantStore)
const context = (id: string | null) => ({ data: { selectedStore: id ? { id, name: '店' } : null } })
beforeEach(() => {
  vi.resetAllMocks()
  net.list.mockResolvedValue({ data: { stores: [store('current')] } })
  net.context.mockResolvedValue(context(null))
  net.select.mockImplementation(async (_account, id) => { net.context.mockResolvedValue(context(id)); return context(id) })
})
afterEach(cleanup)

it('選択中のアカウントに結ぶ現役店を優先し、保管済みと別アカウントと未設定の店を候補から外す', async () => {
  net.list.mockResolvedValue({ data: { stores: [store('archived', 'a', 'archived'), store('other', 'b'), { ...store('unbound'), line_account_id: null }, store('paused', 'a', 'paused'), store('current')] } })
  const { result } = renderHook(() => useBookingMediaStoreSelection('a'))
  await waitFor(() => expect(result.current.status).toBe('ready'))
  expect(result.current.storeId).toBe('current')
  expect(result.current.stores.map(row => row.id)).toEqual(['paused', 'current'])
  expect(net.select).not.toHaveBeenCalled()
})

it('選択店の取得が失敗したら先頭の店へ逃げず、読み直して回復する', async () => {
  net.context.mockRejectedValueOnce(new Error('取得失敗'))
  const { result } = renderHook(() => useBookingMediaStoreSelection('a'))
  await waitFor(() => expect(result.current.status).toBe('error'))
  expect(result.current.storeId).toBe('')
  act(() => result.current.refresh())
  await waitFor(() => expect(result.current.storeId).toBe('current'))
  expect(net.select).not.toHaveBeenCalled()
})

it('関係する店がなくても別の店を選ばず、未選択と空の候補を返す', async () => {
  net.list.mockResolvedValue({ data: { stores: [store('other', 'b')] } })
  net.context.mockResolvedValue(context('other'))
  const { result } = renderHook(() => useBookingMediaStoreSelection('a'))
  await waitFor(() => expect(result.current.status).toBe('ready'))
  expect(result.current.storeId).toBe('')
  expect(result.current.id).toBe('')
  expect(result.current.stores).toEqual([])
})

it('一時停止の店だけなら初期値にせず、統括表示で明示選択しても全体の店舗は切り替えない', async () => {
  net.list.mockResolvedValue({ data: { stores: [store('paused', 'a', 'paused')] } })
  const { result } = renderHook(() => useBookingMediaStoreSelection('a'))
  await waitFor(() => expect(result.current.status).toBe('ready'))
  expect(result.current.storeId).toBe('')
  act(() => result.current.choose('paused'))
  expect(result.current.storeId).toBe('paused')
  expect(net.select).not.toHaveBeenCalled()
})

it('ログインの選択店が同じなら読み、別店なら明示の切り替えが成功するまで媒体用の店IDを返さない', async () => {
  net.context.mockResolvedValue(context('other'))
  const { result } = renderHook(() => useBookingMediaStoreSelection('a'))
  await waitFor(() => expect(result.current.status).toBe('ready'))
  expect(result.current.id).toBe('current')
  expect(result.current.storeId).toBe('')
  expect(net.select).not.toHaveBeenCalled()
  await act(async () => { await result.current.switchContext() })
  expect(net.select).toHaveBeenCalledExactlyOnceWith('a', 'current')
  expect(result.current.storeId).toBe('current')
  await act(async () => { await result.current.switchContext() })
  expect(net.select).toHaveBeenCalledTimes(1)
})

it('切り替えが失敗したら選択が成功したことにせず、同じ店へやり直せる', async () => {
  net.context.mockResolvedValue(context('other'))
  net.select.mockRejectedValueOnce(new Error('再ログインが必要'))
  const { result } = renderHook(() => useBookingMediaStoreSelection('a'))
  await waitFor(() => expect(result.current.status).toBe('ready'))
  await act(async () => { await result.current.switchContext() })
  expect(result.current.storeId).toBe('')
  expect(result.current.contextId).toBe('other')
  expect(result.current.error).toBeInstanceOf(Error)
  await act(async () => { await result.current.switchContext() })
  expect(result.current.storeId).toBe('current')
})

it('別画面の店の変更を再取得し、希望した店は残して自動では戻さない', async () => {
  const { result } = renderHook(() => useBookingMediaStoreSelection('a'))
  await waitFor(() => expect(result.current.storeId).toBe('current'))
  net.context.mockResolvedValue(context('other'))
  await act(async () => { await result.current.recheckContext() })
  expect(result.current.id).toBe('current')
  expect(result.current.storeId).toBe('')
  expect(result.current.changedElsewhere).toBe(true)
  expect(net.select).not.toHaveBeenCalled()
})

it('古いアカウントの遅い取得で新しい店を上書きしない', async () => {
  const old = deferred<{ data: { stores: RestaurantStore[] } }>()
  net.list.mockImplementation(account => account === 'a' ? old.promise : Promise.resolve({ data: { stores: [store('new', 'b')] } }))
  const { result, rerender } = renderHook(({ account }) => useBookingMediaStoreSelection(account), { initialProps: { account: 'a' } })
  rerender({ account: 'b' })
  await waitFor(() => expect(result.current.storeId).toBe('new'))
  await act(async () => { old.resolve({ data: { stores: [store('current')] } }) })
  expect(result.current.storeId).toBe('new')
  expect(result.current.stores.map(row => row.id)).toEqual(['new'])
})
