// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api'
import { useFeatureSettings } from './use-feature-settings'

const m = vi.hoisted(() => ({ account: 'A', load: vi.fn(), usage: vi.fn(), fetch: vi.fn(), get: vi.fn() }))
vi.mock('next/navigation', async () => (await import('@/test-utils/navigation-mock')).navigationMock())
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: m.account }) }))
vi.mock('@/lib/feature-settings-cache', () => ({ loadFeatureSettings: m.load, clearFeatureSettingsCache: vi.fn() }))
vi.mock('@/lib/api', async original => {
  const actual = await original<typeof import('@/lib/api')>()
  return { ...actual, fetchApi: m.fetch, api: { ...actual.api, featureSettings: { get: m.get }, analytics: { usageOverview: m.usage } } }
})
const settings = (scenarios = true, version = 3) => ({ success: true, data: { features: { scenarios, webinars: false }, sidebarItemOrder: {}, specializedFeatureKeys: [], version } })
const impact = (token: string | null, requiresConfirmation = true) => ({ success: true, data: { version: 3, impacts: [{ feature: 'scenarios', items: [{ kind: 'scheduled', targetType: '配信', count: 2 }], blocking: true }], requiresConfirmation, impactToken: token } })
beforeEach(() => {
  vi.resetAllMocks(); m.account = 'A'
  m.load.mockResolvedValue(settings()); m.get.mockResolvedValue(settings(true, 4))
  m.usage.mockResolvedValue({ success: true, data: { data: { categories: [], features: [] } } })
  m.fetch.mockResolvedValue({ success: true, data: { version: 4 } })
})
afterEach(cleanup)
async function ready() {
  const h = renderHook(useFeatureSettings)
  await waitFor(() => expect(h.result.current.loading).toBe(false))
  return h
}
async function turnOff(h: Awaited<ReturnType<typeof ready>>) {
  const item = h.result.current.groups.flatMap(g => g.items).find(i => i.keys.includes('scenarios'))!
  expect(item).toBeTruthy()
  act(() => { h.result.current.toggleItem(item, false); h.result.current.setReason('運用を変更') })
}
it('オフの影響を先に確認し、確認時に取り直したトークンと版だけで保存する', async () => {
  m.fetch.mockResolvedValueOnce(impact('old')).mockResolvedValueOnce(impact('fresh')).mockResolvedValueOnce({ success: true, data: { version: 4 } })
  const h = await ready(); await turnOff(h)
  await act(async () => h.result.current.save())
  expect(h.result.current.impactOpen).toBe(true)
  expect(m.fetch.mock.calls.map(c => c[1].method)).toEqual(['POST'])
  await act(async () => h.result.current.confirmImpactSave())
  expect(m.fetch.mock.calls.map(c => c[1].method)).toEqual(['POST', 'POST', 'PUT'])
  const request = JSON.parse(m.fetch.mock.calls[2][1].body)
  expect(request).toMatchObject({ expectedVersion: 3, impactToken: 'fresh', reason: '運用を変更', features: { scenarios: false, webinars: false } })
  expect(h.result.current.features.scenarios).toBe(true) // サーバーが受理した最終値
  expect(h.result.current.dirty).toBe(false)
})
it('影響0では確認窓を出さず保存し、保存競合では編集値を保つ', async () => {
  m.fetch.mockResolvedValueOnce(impact(null, false)).mockRejectedValueOnce(new ApiError(409, 'conflict'))
  const h = await ready(); await turnOff(h)
  await act(async () => h.result.current.save())
  expect(h.result.current.impactOpen).toBe(false)
  expect(h.result.current.conflict).toBe(true)
  expect(h.result.current.features.scenarios).toBe(false)
  expect(h.result.current.reason).toBe('運用を変更')
  expect(m.get).toHaveBeenCalledWith('A')
})
it('影響の取得失敗では保存せず、状態変化の409は確認し直す', async () => {
  m.fetch.mockRejectedValueOnce(new ApiError(503, 'unavailable'))
  const h = await ready(); await turnOff(h)
  await act(async () => h.result.current.save())
  expect(m.fetch).toHaveBeenCalledTimes(1)
  expect(h.result.current.error).not.toBe('')
  expect(h.result.current.saving).toBe(false)
  m.fetch.mockResolvedValueOnce(impact('first')).mockResolvedValueOnce(impact('fresh')).mockRejectedValueOnce(new ApiError(409, undefined, 'IMPACT_CONFIRMATION_REQUIRED', { impacts: impact('x').data.impacts }))
  await act(async () => h.result.current.save())
  await act(async () => h.result.current.confirmImpactSave())
  expect(h.result.current.impactOpen).toBe(true)
  expect(h.result.current.impactError).not.toBe('')
  expect(h.result.current.features.scenarios).toBe(false)
})
it('Aの影響確認中にBへ切り替えるとAの結果でBを保存しない', async () => {
  let finish!: (v: unknown) => void
  m.fetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const h = await ready(); await turnOff(h)
  let pending!: Promise<void>
  act(() => { pending = h.result.current.save() })
  m.account = 'B'; h.rerender()
  await waitFor(() => expect(m.load).toHaveBeenCalledWith('B'))
  await act(async () => { finish(impact('A')); await pending })
  expect(h.result.current.impactOpen).toBe(false)
  expect(m.fetch).toHaveBeenCalledTimes(1)
  expect(h.result.current.dirty).toBe(false)
})
it('利用数の遅延・失敗は設定を塞がず、利用数だけ読み直せる', async () => {
  let fail!: (e: Error) => void
  m.usage.mockImplementationOnce(() => new Promise((_, reject) => { fail = reject }))
  const h = await ready()
  expect(h.result.current.features.scenarios).toBe(true)
  await act(async () => fail(new Error('offline')))
  expect(h.result.current.usageFailed).toBe(true)
  await act(async () => h.result.current.loadUsage())
  expect(h.result.current.usageFailed).toBe(false)
  expect(m.usage).toHaveBeenCalledTimes(2)
})
