// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AnalyticsMetric, AnalyticsUsageOverview } from '@/lib/api'

const net = vi.hoisted(() => ({ overview: vi.fn() }))
vi.mock('next/navigation', async () => (await import('@/test-utils/navigation-mock')).navigationMock())
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api,
    analytics: { ...actual.api.analytics, usageOverview: net.overview },
    featureSettings: { ...actual.api.featureSettings, visibility: async () => ({ success: true, data: { features: {} } }) },
  } }
})
import UsageV8 from './usage'

const metric = <T,>(value: T | null): AnalyticsMetric<T> => ({ value, state: value === null ? 'unavailable' : 'available', reason: value === null ? '未取得' : null })

beforeEach(() => {
  document.documentElement.dataset.theme = 'v8'
  const data: AnalyticsUsageOverview = {
    lineAccountId: 'account-1', timeZone: 'Asia/Tokyo',
    period: { from: '2026-09-01', to: '2026-10-01' }, dataCutoffAt: '2026-10-01T00:00:00Z',
    data: {
      state: 'available', stateReason: null, checkedAt: '2026-10-01T00:00:00Z', automaticDeletion: false,
      summary: { unusedItems: metric(2), brokenReferences: metric(0), automaticRuns: metric(1), manualSends: metric(0), estimatedHoursSaved: metric(1) },
      categories: [
        { key: 'scenarios', label: 'シナリオ配信', href: '/scenarios', unused: metric(2) },
        { key: 'forms', label: '回答フォーム', href: '/forms', unused: metric(0) },
        { key: 'broadcasts', label: '一斉配信', href: '/broadcasts', unused: metric<number>(null) },
      ].map(item => ({ ...item, created: metric(4), inUse: metric(2), brokenReferences: metric(0), lastUsedAt: metric<string>(null) })),
      features: [],
    },
  }
  net.overview.mockReset().mockResolvedValue({ success: true, data })
})
afterEach(() => { cleanup(); delete document.documentElement.dataset.theme })

it.each(['回答フォーム', '一斉配信'])('未使用がない・未取得の%sは「…」の中に中身を見るだけを置き、片づけるは出さない（行の右端は「…」1つ・）', async label => {
  render(<UsageV8 accountId="account-1" />)
  const cell = await screen.findByText(label, { selector: 'td span' })
  const row = cell.closest('tr')!
  expect(within(row).queryByRole('link', { name: '中身を見る' })).toBeNull()
  fireEvent.click(within(row).getByRole('button', { name: `${label}の操作` }))
  expect(screen.getByRole('menuitem', { name: '中身を見る' })).toBeTruthy()
  expect(screen.queryByRole('menuitem', { name: '片づける' })).toBeNull()
})

it('未使用がある行だけ片づけるを開き、元の行き先を保つ', async () => {
  render(<UsageV8 accountId="account-1" />)
  const menu = await screen.findByRole('button', { name: 'シナリオ配信の操作' })
  fireEvent.click(menu)
  expect(screen.getByRole('menuitem', { name: '中身を見る' }).getAttribute('href')).toContain('/scenarios')
  expect(screen.getByRole('menuitem', { name: '片づける' }).getAttribute('href')).toContain('/scenarios')
})

it('タグと友だち情報欄の内訳を作成・利用中・未使用に分けて表示する', async () => {
  const response = await net.overview();
  response.data.data.categories = [{ key: 'friend_attributes', label: 'タグ・友だち情報', href: '/tags',
    created: metric(8), inUse: metric(3), unused: metric(5), brokenReferences: metric(0), lastUsedAt: metric<string>(null),
    breakdown: [
      { key: 'tags', label: 'タグ', href: '/tags', created: metric(3), inUse: metric(2), unused: metric(1) },
      { key: 'fields', label: '友だち情報欄', href: '/tags?tab=fields', created: metric(5), inUse: metric(1), unused: metric(4) },
    ],
  }];
  net.overview.mockResolvedValue(response);
  render(<UsageV8 accountId="account-1" />);
  const row = (await screen.findByText('タグ・友だち情報', { selector: 'td span' })).closest('tr')!;
  expect(within(row).getByText('保管を除く')).toBeTruthy();
  const cells = within(row).getAllByRole('cell');
  expect(cells[1].textContent).toBe('8タグ 3友だち情報欄 5');
  expect(cells[2].textContent).toBe('3タグ 2友だち情報欄 1');
  expect(cells[3].textContent).toBe('5タグ 1友だち情報欄 4');
});

it('旧応答の合計をタグ数として読み替えず、内訳が未取得であることを残す', async () => {
  const response = await net.overview();
  response.data.data.categories = [{ key: 'friend_attributes', label: 'タグ・友だち情報', href: '/tags',
    created: metric(8), inUse: metric(3), unused: metric(5), brokenReferences: metric(0), lastUsedAt: metric<string>(null) }];
  net.overview.mockResolvedValue(response);
  render(<UsageV8 accountId="account-1" />);
  const row = (await screen.findByText('タグ・友だち情報', { selector: 'td span' })).closest('tr')!;
  expect(within(row).getAllByText('内訳 —（未取得）')).toHaveLength(3);
  expect(within(row).queryByText('タグ 8')).toBeNull();
});
