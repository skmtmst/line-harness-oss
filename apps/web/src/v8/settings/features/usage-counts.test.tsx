// @vitest-environment happy-dom
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useFeatureSettings } from './use-feature-settings'

const net = vi.hoisted(() => ({ account: 'A', load: vi.fn(), usage: vi.fn() }))
vi.mock('next/navigation', async () => (await import('@/test-utils/navigation-mock')).navigationMock())
vi.mock('@/hooks/use-account-style', () => ({ useAccountStyle: () => ({ status: 'ready', data: { style: 'standard', styleSelected: true } }) }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: net.account }) }))
vi.mock('@/lib/feature-settings-cache', () => ({ loadFeatureSettings: net.load, clearFeatureSettingsCache: vi.fn() }))
vi.mock('@/lib/api', async original => {
  const actual = await original<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, analytics: { ...actual.api.analytics, usageOverview: net.usage } } }
})
const metric = (value: number) => ({ value, state: 'available', reason: null })
const category = () => ({ key: 'friend_attributes', label: 'タグ・友だち情報', href: '/tags',
  created: metric(8), inUse: metric(3), unused: metric(5), brokenReferences: metric(0), lastUsedAt: { value: null, state: 'unavailable', reason: '未取得' } })
beforeEach(() => {
  vi.resetAllMocks(); net.account = 'A'
  net.load.mockResolvedValue({ success: true, data: { features: {}, sidebarItemOrder: {}, specializedFeatureKeys: [], version: 3 } })
})
afterEach(cleanup)

it('機能設定のタグ数は情報欄を合算せず、タグ内訳の数だけを使う', async () => {
  net.usage.mockResolvedValue({ success: true, data: { data: { categories: [{ ...category(), breakdown: [
    { key: 'tags', label: 'タグ', href: '/tags', created: metric(3), inUse: metric(2), unused: metric(1) },
    { key: 'fields', label: '友だち情報欄', href: '/tags?tab=fields', created: metric(5), inUse: metric(1), unused: metric(4) },
  ] }], features: [] } } })
  const h = renderHook(useFeatureSettings)
  await waitFor(() => expect(h.result.current.loading).toBe(false))
  await waitFor(() => expect(h.result.current.usageByItemId.has('friend-attributes')).toBe(true))
  expect(h.result.current.usageByItemId.get('friend-attributes')).toMatchObject({
    label: 'タグ', created: metric(3), inUse: metric(2), unused: metric(1),
  })
});

it('タグ内訳のない旧応答では合算値も0も使わず、未取得と理由を返す', async () => {
  net.usage.mockResolvedValue({ success: true, data: { data: { categories: [category()], features: [] } } })
  const h = renderHook(useFeatureSettings)
  await waitFor(() => expect(h.result.current.loading).toBe(false))
  await waitFor(() => expect(h.result.current.usageByItemId.has('friend-attributes')).toBe(true))
  const tags = h.result.current.usageByItemId.get('friend-attributes')!
  for (const value of [tags.created, tags.inUse, tags.unused]) {
    expect(value.value).toBeNull(); expect(value.state).toBe('unavailable'); expect(value.reason).toContain('タグの内訳')
  }
});
