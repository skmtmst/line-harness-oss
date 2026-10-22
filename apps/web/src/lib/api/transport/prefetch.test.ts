// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { api } from '../../api'
import { clearPrefetchedReads, prefetchApiRead } from './prefetch'
import { prefetchLineAccounts, clearLineAccountsCache } from '../../line-accounts-cache'
import { clearCommonCaches } from '../../common-caches'

let csrf = 'fixture-session'
const ok = () => new Response(JSON.stringify({ success: true, data: { id: 'fixture', role: 'owner' } }))
beforeEach(() => {
  csrf = 'fixture-session'
  clearPrefetchedReads()
  clearLineAccountsCache()
  vi.stubGlobal('localStorage', { getItem: (key: string) => key === 'lh_csrf' ? csrf : null })
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('一覧が未完了でも本人情報を先に読み、利用側が同じ1本を受け取る', async () => {
  let resolveList!: (value: Response) => void
  const fetch = vi.fn((url: string) => url.includes('/api/line-accounts')
    ? new Promise<Response>(resolve => { resolveList = resolve }) : Promise.resolve(ok()))
  vi.stubGlobal('fetch', fetch)
  prefetchLineAccounts()
  const me = await api.staff.me()
  expect(me).toMatchObject({ success: true, data: { id: 'fixture' } })
  expect(fetch.mock.calls.filter(([url]) => url.endsWith('/api/staff/me'))).toHaveLength(1)
  resolveList(new Response('{"success":true,"data":[]}'))
  await api.staff.me()
  expect(fetch.mock.calls.filter(([url]) => url.endsWith('/api/staff/me'))).toHaveLength(2)
})

it.each(['csrf', 'bearer', 'invalidate', 'expiry'] as const)('%s が変われば先読みを使わない', async kind => {
  let token = 'fixture-a'
  vi.stubGlobal('sessionStorage', { getItem: (key: string) => key === 'lh_admin_session_fallback' ? token : null })
  const fetch = vi.fn(async () => ok())
  vi.stubGlobal('fetch', fetch)
  let now = 1000
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  prefetchApiRead('/api/staff/me')
  if (kind === 'csrf') csrf = 'fixture-new-session'
  if (kind === 'bearer') token = 'fixture-b'
  if (kind === 'invalidate') clearCommonCaches()
  if (kind === 'expiry') now += 30_001
  await api.staff.me()
  expect(fetch).toHaveBeenCalledTimes(2)
})

it('先読みの失敗は保持せず次の読取で再試行する', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response('{"error":"denied"}', { status: 403 }))
    .mockImplementation(async () => ok())
  vi.stubGlobal('fetch', fetch)
  prefetchApiRead('/api/staff/me')
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
  await new Promise(resolve => setTimeout(resolve, 0))
  await expect(api.staff.me()).resolves.toMatchObject({ success: true })
  expect(fetch).toHaveBeenCalledTimes(2)
})

it('認証世代が分からない場合は先読みしない', () => {
  csrf = ''
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  prefetchApiRead('/api/staff/me')
  expect(fetch).not.toHaveBeenCalled()
})
