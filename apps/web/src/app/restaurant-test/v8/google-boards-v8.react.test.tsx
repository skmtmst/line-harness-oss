// @vitest-environment happy-dom
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ snapshot: vi.fn(), connection: vi.fn() }))
const search = vi.hoisted(() => ({ tab: null as string | null, view: null as string | null }))

vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'account-1', setSelectedAccountId: vi.fn(), accounts: [] }) }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/restaurant-test/google',
  useSearchParams: () => ({ get: (key: string) => (key === 'tab' ? search.tab : key === 'view' ? search.view : null) }),
}))
vi.mock('@/lib/restaurant-test-api', () => ({ restaurantTestApi: { snapshot: fixture.snapshot } }))
vi.mock('@/lib/restaurant-google-api', () => ({
  restaurantGoogleApi: { connection: fixture.connection },
}))
// 中身（v7）は置き換え、外枠（V8）だけを確かめる。外枠なしで呼ばれていることも見る。
vi.mock('../google/google-business', () => ({
  default: ({ embedded = false }: { embedded?: boolean }) => <div>{embedded ? '中身だけ' : '外枠つき'}</div>,
}))

import GoogleV8 from './google'

const store = { id: 'store-1', organization_id: 'org-1', name: '渋谷店', code: 'SHIBUYA', area: null, capacity: 26, timezone: 'Asia/Tokyo', status: 'active', line_status: 'connected', google_status: 'connected', line_account_id: 'account-1', line_account_name: '渋谷' }
const connectionData = {
  success: true,
  store: { id: 'store-1', name: '渋谷店', lineAccountId: 'account-1' },
  connection: { status: 'connected', googleAccountEmail: 't@example.com', locationTitle: '渋谷店', locationMapsUrl: null, connectedAt: null, lastSyncedAt: null, lastSyncError: null, averageRating: 4.2, totalReviewCount: 24 },
  candidates: [],
  summary: { unrepliedCount: 2, draftCount: 1, attentionCount: 1, newCount: 0, storedCount: 24, postsAttentionCount: 0, syncStale: false },
  writeEnabled: true,
  oauthConfigured: true,
  aiAvailable: false,
  permissions: { canManageConnection: true, canPublishReply: true },
}

beforeEach(() => {
  search.tab = null
  search.view = null
  fixture.snapshot.mockResolvedValue({ data: { organization: { id: 'org-1', account_id: 'account-1', tenant_id: null, tenant_name: null, name: '組', status: 'active' }, stores: [store] } })
  fixture.connection.mockResolvedValue(connectionData)
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

/** 外枠（V8）が出ていて、選んでいるタブが合っていることを見る。 */
function expectShell(selectedLabel: string) {
  // 見出し・検証環境の帯
  expect(screen.getByRole('heading', { name: 'Googleビジネス' })).not.toBeNull()
  expect(screen.getByText('検証環境専用')).not.toBeNull()
  // タブは5つで、選んでいるものは1つだけ
  const tabs = screen.getByRole('navigation', { name: 'Googleビジネスの機能' })
  const buttons = Array.from(tabs.querySelectorAll('button'))
  expect(buttons.map((button) => button.textContent?.replace(/\s+\d+$/, ''))).toEqual([
    '口コミ', '投稿', 'パフォーマンス', 'プロフィール', '設定',
  ])
  const selected = buttons.filter((button) => button.getAttribute('aria-selected') === 'true')
  expect(selected).toHaveLength(1)
  expect(selected[0]?.textContent?.replace(/\s+\d+$/, '')).toBe(selectedLabel)
  // 数の並びは4つ
  for (const label of ['未返信', '平均の評価', '要確認', 'Google経由の予約']) {
    expect(screen.getByText(label)).not.toBeNull()
  }
}

/*
 * Googleビジネス子板6枚の契約。タブ・状態ごとに外枠の板IDが出ることを固定する。
 * 外枠（見出し・帯・タブ・数4）は口コミタブと同じものを全部のタブで出す。
 * 中身は今の作り（v7）を外枠なし（embedded）で入れる。
 */
describe('Googleビジネス子板の印', () => {
  it.each([
    ['performance', null, 'SrmVs', 'パフォーマンス'],
    ['profile', null, 'JUTGz', 'プロフィール'],
    ['profile', 'hours', 'JUTGz', 'プロフィール'],
    ['posts', null, 'Cfed0', '投稿'],
    ['posts', 'new', 'T1j2Sw', '投稿'],
    ['posts', 'confirm', 'T1j2Sw', '投稿'],
    ['settings', null, 'CuHXG', '設定'],
    ['reviews', 'draft', 'x9HIR', '口コミ'],
  ])('tab=%s view=%s → %s', async (tab, view, node, selectedLabel) => {
    search.tab = tab
    search.view = view
    render(<GoogleV8 />)
    await screen.findByText('中身だけ')
    expect(document.querySelector(`[data-design-node="${node}"]`)).not.toBeNull()
    expectShell(selectedLabel)
  })

  it('未接続は設定の印 CuHXG・設定タブ以外は押せない', async () => {
    search.tab = null
    search.view = null
    fixture.connection.mockResolvedValue({ ...connectionData, connection: { ...connectionData.connection, status: 'new' } })
    render(<GoogleV8 />)
    await screen.findByText('中身だけ')
    expect(document.querySelector('[data-design-node="CuHXG"]')).not.toBeNull()
    expectShell('設定')
    const tabs = screen.getByRole('navigation', { name: 'Googleビジネスの機能' })
    const disabled = Array.from(tabs.querySelectorAll('button')).filter((button) => button.hasAttribute('disabled'))
    expect(disabled.map((button) => button.textContent)).toEqual(['口コミ', '投稿', 'パフォーマンス', 'プロフィール'])
  })
})
