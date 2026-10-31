// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { flushListUrlState } from '@/components/shared/list-url-state'
const calls = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('@/lib/api', async original => {
  const actual = await original<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, usersGrouped: { ...actual.api.usersGrouped, list: calls.list }, lineAccounts: { ...actual.api.lineAccounts, list: async () => ({ success: true, data: [] }) } } }
})
import { useMergedUsers } from './use-merged-users'
afterEach(() => { cleanup(); vi.clearAllMocks() })
it('初回と再読み込みの3ページ目を保ち、本文が作り直される店舗切替では1へ戻す', async () => {
  window.history.replaceState(null, '', '/friends?tab=merged&page=3')
  window.dispatchEvent(new PopStateEvent('popstate'))
  calls.list.mockImplementation(async (input: { memberAccountId: string; page: number }) => ({ success: true, data: {
    memberAccountId: input.memberAccountId, total: input.memberAccountId === 'a' ? 120 : 1, page: input.page,
    rows: [{ identityKey: input.memberAccountId, displayName: input.memberAccountId, accounts: [{ accountId: input.memberAccountId }], emails: [], phones: [] }],
  } }))
  const initial = renderHook(() => useMergedUsers('a'))
  await waitFor(() => expect(initial.result.current.loading).toBe(false))
  expect(initial.result.current.page).toBe(3)
  act(() => flushListUrlState())
  expect(new URLSearchParams(window.location.search).get('memberAccount')).toBe('a')
  initial.unmount()
  const reloaded = renderHook(() => useMergedUsers('a'))
  await waitFor(() => expect(reloaded.result.current.loading).toBe(false))
  expect(reloaded.result.current.page).toBe(3)
  reloaded.unmount()
  const switched = renderHook(() => useMergedUsers('b'))
  await waitFor(() => expect(switched.result.current.page).toBe(1))
  await waitFor(() => expect(switched.result.current.rows[0]?.displayName).toBe('b'))
  act(() => flushListUrlState())
  expect(new URLSearchParams(window.location.search).get('memberAccount')).toBe('b')
  expect(new URLSearchParams(window.location.search).get('page')).toBeNull()
  expect(calls.list).toHaveBeenCalledWith(expect.objectContaining({ memberAccountId: 'b', page: 1 }))
})
