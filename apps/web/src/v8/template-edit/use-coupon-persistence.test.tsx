// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BroadcastMessageAsset } from '@/lib/api'
import { AssetPublishError, useCouponPersistence } from './use-coupon-persistence'

const ports = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), publish: vi.fn() }))
vi.mock('@/lib/api', () => ({ api: { broadcastMessageAssets: ports } }))
const asset = { id: 'coupon-1', lineAccountId: 'account-a', kind: 'coupon', name: '券', payload: { description: '案内' }, publishedVersion: 0, draftRevision: 1 } as BroadcastMessageAsset
const payload = { description: '案内', discount: { mode: 'percent', percent: 20 } }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
beforeEach(() => {
  vi.resetAllMocks()
  ports.create.mockResolvedValue({ success: true, data: asset })
  ports.update.mockResolvedValue({ success: true, data: { ...asset, publishedVersion: 2, draftRevision: 3 } })
  ports.publish.mockResolvedValue({ success: true, data: { ...asset, publishedVersion: 1, draftRevision: 0 } })
})
afterEach(cleanup)

describe('クーポンの保存と公開', () => {
  it('公開失敗の技術的な文を画面向けの文にせず原因は保持する', () => {
    const cause = new Error('API error: 500')
    const error = new AssetPublishError(cause)
    expect(error.message).toBe('公開を確認できませんでした。')
    expect(error.cause).toBe(cause)
  })
  it('下書きは保存だけで、資産フォルダのIDを送る', async () => {
    const { result } = renderHook(() => useCouponPersistence('account-a'))
    expect(await result.current('券', payload, 'asset-folder-1', 'snapshot', false)).toBe('coupon-1')
    expect(ports.create).toHaveBeenCalledWith({ lineAccountId: 'account-a', kind: 'coupon', name: '券', payload, folderId: 'asset-folder-1' })
    expect(ports.publish).not.toHaveBeenCalled()
  })
  it('保存して公開は実publishに保存応答の版を渡す', async () => {
    const { result } = renderHook(() => useCouponPersistence('account-a'))
    await result.current('券', payload, null, 'snapshot', true)
    expect(ports.publish).toHaveBeenCalledWith('coupon-1', { expectedVersion: 0, expectedDraftRevision: 1 }, expect.any(String))
  })
  it('既存の券は更新してから、その応答の版で公開する', async () => {
    const { result } = renderHook(() => useCouponPersistence('account-a', asset))
    await result.current('券', payload, null, 'changed', true)
    expect(ports.create).not.toHaveBeenCalled()
    expect(ports.update).toHaveBeenCalledWith('coupon-1', { name: '券', payload, folderId: null })
    expect(ports.publish).toHaveBeenCalledWith('coupon-1', { expectedVersion: 2, expectedDraftRevision: 3 }, expect.any(String))
  })
  it.each([new Error('409: 別の人が変更しました'), new Error('通信が切れました')])('公開失敗時は下書き・確認キーを再利用して重複保存しない: %s', async error => {
    ports.publish.mockRejectedValueOnce(error)
    const { result } = renderHook(() => useCouponPersistence('account-a'))
    await expect(result.current('券', payload, null, 'snapshot', true)).rejects.toMatchObject({ message: '公開を確認できませんでした。', cause: error })
    const first = ports.publish.mock.calls[0]
    await expect(result.current('券', payload, null, 'snapshot', true)).resolves.toBe('coupon-1')
    expect(ports.create).toHaveBeenCalledTimes(1)
    expect(ports.update).not.toHaveBeenCalled()
    expect(ports.publish.mock.calls[1]).toEqual(first)
  })
  it.each(['rich_message', 'research'] as const)('%s の2回目保存は資産フォルダを上書きしない', async kind => {
    const existing = { ...asset, kind, folderId: 'asset-folder-1' } as BroadcastMessageAsset
    const { result } = renderHook(() => useCouponPersistence('account-a', existing, kind))
    await result.current('編集', { ...payload, folder: '旧形式のフォルダ' }, null, 'changed', false)
    expect(ports.update).toHaveBeenCalledWith('coupon-1', { name: '編集', payload: { ...payload, folder: '旧形式のフォルダ' } })
  })
  it('公開失敗後に編集すると新しい下書きの版とキーを使う', async () => {
    const cause = new Error('競合')
    ports.publish.mockRejectedValueOnce(cause)
    const { result } = renderHook(() => useCouponPersistence('account-a'))
    await expect(result.current('券', payload, null, 'first', true)).rejects.toMatchObject({ message: '公開を確認できませんでした。', cause })
    const firstKey = ports.publish.mock.calls[0][2]
    await result.current('変更', { ...payload, description: '変更' }, null, 'second', true)
    expect(ports.update).toHaveBeenCalledTimes(1)
    expect(ports.publish.mock.calls[1][1]).toEqual({ expectedVersion: 2, expectedDraftRevision: 3 })
    expect(ports.publish.mock.calls[1][2]).not.toBe(firstKey)
  })
  it('同じ保存の連打は同じPromiseになり、異なる操作は待つように知らせる', async () => {
    const wait = deferred<{ success: true; data: BroadcastMessageAsset }>()
    ports.create.mockReturnValue(wait.promise)
    const { result } = renderHook(() => useCouponPersistence('account-a'))
    const first = result.current('券', payload, null, 'snapshot', true)
    expect(result.current('券', payload, null, 'snapshot', true)).toBe(first)
    await expect(result.current('券', payload, null, 'snapshot', false)).rejects.toThrow('保存中')
    wait.resolve({ success: true, data: asset }); await first
    expect(ports.create).toHaveBeenCalledTimes(1); expect(ports.publish).toHaveBeenCalledTimes(1)
  })
  it('保存中にアカウントが変われば、前のアカウントを公開しない', async () => {
    const wait = deferred<{ success: true; data: BroadcastMessageAsset }>()
    ports.create.mockReturnValue(wait.promise)
    const { result, rerender } = renderHook(({ account }) => useCouponPersistence(account), { initialProps: { account: 'account-a' } })
    const saving = result.current('券', payload, null, 'snapshot', true)
    act(() => rerender({ account: 'account-b' }))
    wait.resolve({ success: true, data: asset })
    await expect(saving).rejects.toThrow('アカウントが変わりました')
    expect(ports.publish).not.toHaveBeenCalled()
  })
  it('保存中にアカウントを行き来しても元の操作を公開しない', async () => {
    const wait = deferred<{ success: true; data: BroadcastMessageAsset }>()
    ports.create.mockReturnValue(wait.promise)
    const { result, rerender } = renderHook(({ account }) => useCouponPersistence(account), { initialProps: { account: 'account-a' } })
    const saving = result.current('券', payload, null, 'snapshot', true)
    act(() => rerender({ account: 'account-b' }))
    act(() => rerender({ account: 'account-a' }))
    wait.resolve({ success: true, data: asset })
    await expect(saving).rejects.toThrow('アカウントが変わりました')
    expect(ports.publish).not.toHaveBeenCalled()
  })
  it('版が不明の応答を0で埋めて公開しない', async () => {
    ports.create.mockResolvedValue({ success: true, data: { ...asset, draftRevision: undefined } })
    const { result } = renderHook(() => useCouponPersistence('account-a'))
    await expect(result.current('券', payload, null, 'snapshot', true)).rejects.toThrow('版の番号')
    expect(ports.publish).not.toHaveBeenCalled()
  })
  it('保存失敗・未選択の時は公開しない', async () => {
    ports.create.mockResolvedValue({ success: false, error: '保存の詳細' })
    const { result, rerender } = renderHook(({ account }: { account: string | null }) => useCouponPersistence(account), { initialProps: { account: 'account-a' as string | null } })
    await expect(result.current('券', payload, null, 'snapshot', true)).rejects.toThrow('保存の詳細')
    act(() => rerender({ account: null }))
    await expect(result.current('券', payload, null, 'snapshot', true)).rejects.toThrow('選んでください')
    expect(ports.publish).not.toHaveBeenCalled()
  })
})
