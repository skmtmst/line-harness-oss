// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useUberConnection } from './use-uber-connection'

const connection = vi.hoisted(() => vi.fn())
vi.mock('@/lib/restaurant-delivery-api', () => ({ restaurantDeliveryApi: { ubereatsConnection: connection } }))
afterEach(() => { cleanup(); vi.resetAllMocks() })

it.each([
  ['connected', null, 'connected'],
  ['disconnected', null, 'disconnected'],
  ['pending_store', null, 'disconnected'],
  ['expired', null, 'error'],
  ['no_permission', null, 'error'],
  ['pending_store', 'pos_activation_unknown', 'error'],
  ['pending_store', 'pos_activation_started', 'error'],
])('保存済みの%s/%sを接続の状態へ読み替える', async (status, lastError, expected) => {
  connection.mockResolvedValue({ connection: { status, lastError } })
  const { result } = renderHook(() => useUberConnection('account-1'))
  await waitFor(() => expect(result.current).toBe(expected))
  expect(connection).toHaveBeenCalledWith('account-1')
})

it('読込失敗を未接続や接続済みとみなさない', async () => {
  connection.mockRejectedValue(new Error('offline'))
  const { result } = renderHook(() => useUberConnection('account-1'))
  await act(async () => {})
  expect(result.current).toBeNull()
})

it('別のアカウントへ移ると古い店の値を消し、遅い返事を混ぜない', async () => {
  let resolveFirst!: (value: unknown) => void
  connection.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve }))
    .mockResolvedValueOnce({ connection: { status: 'disconnected', lastError: null } })
  const { result, rerender } = renderHook(({ accountId }) => useUberConnection(accountId), { initialProps: { accountId: 'first' } })
  rerender({ accountId: 'second' })
  await waitFor(() => expect(result.current).toBe('disconnected'))
  await act(async () => { resolveFirst({ connection: { status: 'connected', lastError: null } }) })
  expect(result.current).toBe('disconnected')
})

it('未選択では照会せず、選択解除でも前の接続を表示しない', async () => {
  connection.mockResolvedValue({ connection: { status: 'connected', lastError: null } })
  const { result, rerender } = renderHook(({ accountId }: { accountId: string | null }) => useUberConnection(accountId), { initialProps: { accountId: null as string | null } })
  expect(connection).not.toHaveBeenCalled()
  rerender({ accountId: 'first' })
  await waitFor(() => expect(result.current).toBe('connected'))
  rerender({ accountId: null })
  expect(result.current).toBeNull()
})
