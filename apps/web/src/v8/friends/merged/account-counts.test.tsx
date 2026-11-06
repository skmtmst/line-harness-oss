// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { UserRowData } from '@/components/users/users-types'
const calls = vi.hoisted(() => ({ list: vi.fn(), accounts: vi.fn(), initialPage: 1 }))
vi.mock('@/components/shared/list-url-state', async () => {
  const { useState } = await import('react')
  const actual = await vi.importActual<typeof import('@/components/shared/list-url-state')>('@/components/shared/list-url-state')
  return { ...actual, useListUrlValue: (key: string, initial: unknown) => useState(key === 'page' ? calls.initialPage : initial) }
})
vi.mock('@/lib/api', async original => {
  const actual = await original<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, usersGrouped: { ...actual.api.usersGrouped, list: calls.list }, lineAccounts: { ...actual.api.lineAccounts, list: calls.accounts } } }
})
import { useMergedUsers } from './use-merged-users'
const row = (name: string, accountId = 'a') => ({ identityKey: name, displayName: name, emails: [], phones: [], accounts: [{ accountId, accountName: name, lineUserId: 'U'+name }], identityKeyKind: 'solo', lastActivityAt: '' }) as UserRowData
const response = (name: string, total = 1, memberAccountId = 'a') => ({ success: true, data: { memberAccountId, rows: [row(name, memberAccountId)], total, page: 1, pageSize: 20, computedAt: '' } })
const pending = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
beforeEach(() => {
  window.history.replaceState(null, '', '/friends?tab=merged'); window.dispatchEvent(new PopStateEvent('popstate'))
  calls.list.mockReset(); calls.accounts.mockReset(); calls.initialPage = 1
  calls.accounts.mockResolvedValue({ success: true, data: [] })
  calls.list.mockImplementation(async (input: { memberAccountId: string; pageSize: number; uid?: string }) => response(input.memberAccountId, input.pageSize === 1 ? 7 : input.uid ? 2 : 7, input.memberAccountId))
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })
it('選択店を全件数と表示条件の両方へ渡し、絞り込みで全件数を変えない', async () => {
  const view = renderHook(() => useMergedUsers('a'))
  await waitFor(() => expect(view.result.current.memberTotal).toBe(7))
  await waitFor(() => expect(view.result.current.total).toBe(7))
  act(() => { view.result.current.setUid('linked'); view.result.current.setAccount('b') })
  await waitFor(() => expect(view.result.current.total).toBe(2))
  expect(view.result.current.memberTotal).toBe(7)
  expect(calls.list).toHaveBeenCalledWith(expect.objectContaining({ memberAccountId: 'a', uid: 'linked', account: 'b' }))
  expect(calls.list.mock.calls.every(([input]) => input.memberAccountId === 'a')).toBe(true)
})
it('Aから未選択へ戻してAを開き直すと、最初のAの遅い行と件数を捨てる', async () => {
  const oldRows = pending<ReturnType<typeof response>>(), oldTotal = pending<ReturnType<typeof response>>()
  let old = true
  calls.list.mockImplementation((input: { pageSize: number }) => old ? input.pageSize === 1 ? oldTotal.promise : oldRows.promise : Promise.resolve(response('new-a', 1)))
  const view = renderHook(({ account }) => useMergedUsers(account), { initialProps: { account: 'a' as string | null } })
  await waitFor(() => expect(calls.list).toHaveBeenCalledTimes(2))
  view.rerender({ account: null })
  expect(view.result.current.rows).toEqual([])
  expect(view.result.current.memberTotal).toBeNull()
  expect(calls.list).toHaveBeenCalledTimes(2)
  old = false; view.rerender({ account: 'a' })
  await waitFor(() => expect(view.result.current.rows[0]?.displayName).toBe('new-a'))
  await act(async () => { oldRows.resolve(response('old-a', 99)); oldTotal.resolve(response('old-a', 99)) })
  expect(view.result.current.total).toBe(1)
  expect(view.result.current.memberTotal).toBe(1)
  expect(view.result.current.rows[0]?.displayName).toBe('new-a')
})
it('件数の取得失敗は0にせず、取得済みの行はそのまま使える', async () => {
  calls.list.mockImplementation(async (input: { pageSize: number }) => { if (input.pageSize === 1) throw new Error('offline'); return response('a') })
  const view = renderHook(() => useMergedUsers('a'))
  await waitFor(() => expect(view.result.current.summaryStatus).toBe('error'))
  await waitFor(() => expect(view.result.current.rows).toHaveLength(1))
  expect(view.result.current.memberTotal).toBeNull()
})
it('CSVも選択店と同じ条件を使い、待機中に店を変えたらダウンロードしない', async () => {
  const csv = pending<ReturnType<typeof response>>()
  calls.list.mockImplementation((input: { memberAccountId: string; pageSize: number }) => input.pageSize === 200 ? csv.promise : Promise.resolve(response(input.memberAccountId, 1, input.memberAccountId)))
  const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fixture')
  const view = renderHook(({ account }) => useMergedUsers(account), { initialProps: { account: 'a' } })
  await waitFor(() => expect(view.result.current.loading).toBe(false))
  const oldExport = view.result.current.exportCsv
  let task: Promise<void> | undefined
  act(() => { task = oldExport() })
  expect(calls.list).toHaveBeenCalledWith(expect.objectContaining({ memberAccountId: 'a', pageSize: 200 }))
  view.rerender({ account: 'b' })
  await act(async () => { csv.resolve(response('a')); await task })
  expect(create).not.toHaveBeenCalled()
  const count = calls.list.mock.calls.length
  await act(async () => { await oldExport() })
  expect(calls.list).toHaveBeenCalledTimes(count)
})

it('古いWorkerが固定条件を無視した応答を返しても全店の行や人数を出さない', async () => {
  calls.list.mockResolvedValue({ success: true, data: { rows: [row('other', 'b')], total: 99, page: 1, pageSize: 20 } })
  const view = renderHook(() => useMergedUsers('a'))
  await waitFor(() => expect(view.result.current.loading).toBe(false))
  await waitFor(() => expect(view.result.current.summaryStatus).toBe('error'))
  expect(view.result.current.rows).toEqual([])
  expect(view.result.current.memberTotal).toBeNull()
  expect(view.result.current.error).not.toBe('')
})


it('ページ付きの入口を保ち、初回の店舗読込では戻さず、別店舗への切替だけ1へ戻す', async () => {
  calls.initialPage = 3
  const view = renderHook(({ account }) => useMergedUsers(account), { initialProps: { account: null as string | null } })
  expect(view.result.current.page).toBe(3)
  expect(view.result.current.summaryStatus).toBe('idle')
  view.rerender({ account: 'a' })
  await waitFor(() => expect(view.result.current.loading).toBe(false))
  expect(view.result.current.page).toBe(3)
  expect(calls.list).toHaveBeenCalledWith(expect.objectContaining({ memberAccountId: 'a', page: 3 }))
  view.rerender({ account: 'b' })
  await waitFor(() => expect(view.result.current.page).toBe(1))
})
