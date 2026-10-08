import { afterEach, beforeAll, expect, test, vi } from 'vitest'
let api: typeof import('./api').api
let bookingApi: typeof import('./api').bookingApi
beforeAll(async () => { ({ api, bookingApi } = await import('./api')) })
afterEach(() => vi.unstubAllGlobals())
function capture(data: unknown = {}) {
  const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ success: true, data }), { headers: { 'Content-Type': 'application/json' } }))
  vi.stubGlobal('fetch', fetch)
  return fetch
}
test('WEB052 sends one account-scoped batch with every loaded revision', async () => {
  const fetch = capture()
  const body = { changes: [{ id: 'one', expectedVersion: 2, sortOrder: 1 }, { id: 'two', expectedVersion: 3, sortOrder: 0 }] }
  await bookingApi.reorderMenus('account/a', body)
  expect(fetch).toHaveBeenCalledTimes(1)
  const [url, options] = fetch.mock.calls[0] as unknown as [string, RequestInit]
  expect(new URL(url).pathname).toBe('/api/booking/admin/menus/order')
  expect(new URL(url).searchParams.get('account_id')).toBe('account/a')
  expect(JSON.parse(options.body as string)).toEqual(body)
})
test('WEB074/075 sends multi-type, personal filters and offset to the server', async () => {
  const fetch = capture()
  await api.mileage.history({ accountId: 'a', friendId: 'f', entryTypes: ['spend', 'reversal'], kind: 'voided', search: '取消', from: '2026-10-01', limit: 20, offset: 100 })
  const query = new URL(fetch.mock.calls[0][0] as string).searchParams
  expect(Object.fromEntries(query)).toMatchObject({ friendId: 'f', entryTypes: 'spend,reversal', kind: 'voided', search: '取消', from: '2026-10-01', limit: '20', offset: '100' })
})
test('WEB084 preserves explicit false and nearest order in the query', async () => {
  const fetch = capture()
  await api.reminders.runs('r', { status: 'planned', order: 'scheduled_asc', executedOnly: false, limit: 50, offset: 50 })
  expect(Object.fromEntries(new URL(fetch.mock.calls[0][0] as string).searchParams)).toMatchObject({ status: 'planned', order: 'scheduled_asc', executedOnly: 'false', offset: '50' })
})
test('WEB232 sends inactive creation and the step-up header together', async () => {
  const fetch = capture()
  await api.webhooks.outgoing.create({ lineAccountId: 'a', name: '下書き', url: 'https://example.com', eventTypes: ['*'], secret: 'test-secret', isActive: false }, 'grant')
  const options = fetch.mock.calls[0][1] as RequestInit
  expect(JSON.parse(options.body as string)).toMatchObject({ isActive: false })
  expect(new Headers(options.headers).get('X-Step-Up-Token')).toBe('grant')
})
test('WEB205 retries send the same key to generation creation', async () => {
  const fetch = capture()
  await api.hqBanners.projects.createGeneration('p', { presetKey: 'line_rich_message', count: 1, textLines: ['a'] }, { idempotencyKey: 'stable-key' })
  const [url, options] = fetch.mock.calls[0] as unknown as [string, RequestInit]
  expect(new URL(url).pathname).toBe('/api/hq/banners/projects/p/generations')
  expect(new Headers(options.headers).get('Idempotency-Key')).toBe('stable-key')
})
test('WEB222 paged list retains total and supports reading the second 200-item page', async () => {
  const fetch = capture({ items: [], total: 201, limit: 200, sort: [] })
  const response = await api.richMenuGroups.listPage('a', { page: 2, limit: 200 })
  expect(response.data?.total).toBe(201)
  expect(new URL(fetch.mock.calls[0][0] as string).searchParams.get('page')).toBe('2')
})
test('WEB196/198 preserves new server metrics in the client response', async () => {
  capture({ items: [{ id: 'c', duplicateGroupKey: 'opaque', duplicateCandidateCount: 2, isDuplicateSuspicion: true }] })
  const candidates = await api.ecCommerce.operationIdentityCandidates({ lineAccountId: 'a' })
  expect(candidates.data?.items[0]).toMatchObject({ duplicateCandidateCount: 2, isDuplicateSuspicion: true })
  capture({ sentToday: 0, sentLast30d: 0, byEventType: [], failures: { total: 3, failed: 1, retryWaiting: 2, scope: 'all_time_unresolved' } })
  const counts = await api.lineNotifications.sendCounts('a')
  expect(counts.data?.failures.total).toBe(3)
})
