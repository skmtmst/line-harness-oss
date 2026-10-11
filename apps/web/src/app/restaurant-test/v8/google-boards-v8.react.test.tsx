// @vitest-environment happy-dom
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ snapshot: vi.fn(), connection: vi.fn() }))
const search = vi.hoisted(() => ({ tab: null as string | null, view: null as string | null }))

vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'account-1', setSelectedAccountId: vi.fn(), accounts: [] }) }))
vi.mock('next/navigation',async()=>({... (await import('@/test-utils/navigation-mock')).navigationMock(),
 usePathname:()=>'/restaurant-test/google',
 useSearchParams:()=>new URLSearchParams({...search.tab?{tab:search.tab}:{},...search.view?{view:search.view,id:'r1'}:{}}),
}))
vi.mock('@/components/shell/page-chrome',async()=> (await import('@/test-utils/page-chrome-mock')).pageChromeMock())
vi.mock('@/lib/restaurant-test-api', () => ({ restaurantTestApi: { snapshot: fixture.snapshot } }))
vi.mock('@/lib/restaurant-google-api', () => ({
  restaurantGoogleApi: { connection: fixture.connection },
}))
// Inspect the live URL-to-board mapping; child behavior has its own tests.
vi.mock('@/v8/restaurant/google/reviews',()=>({ReviewDraft:()=> <div>現役の子画面</div>,ReviewsBoard:()=> <div>現役の子画面</div>}))
vi.mock('@/v8/restaurant/google/posts',()=>({PostEditor:()=> <div>現役の子画面</div>,PostConfirm:()=> <div>現役の子画面</div>,PostsBoard:()=> <div>現役の子画面</div>}))
vi.mock('@/v8/restaurant/google/performance',()=>({default:()=> <div>現役の子画面</div>}))
vi.mock('@/v8/restaurant/google/profile',()=>({default:()=> <div>現役の子画面</div>}))
vi.mock('@/v8/restaurant/google/profile-confirm',()=>({ChangeConfirmScreen:()=> <div>現役の子画面</div>}))
vi.mock('@/v8/restaurant/google/profile-history',()=>({HistoryScreen:()=> <div>現役の子画面</div>}))
vi.mock('@/v8/restaurant/google/settings',()=>({default:()=> <div>現役の子画面</div>}))
import GoogleV8 from '@/v8/restaurant/google/google'

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

/*
 * Googleビジネス子板6枚の契約。タブ・状態ごとに外枠の板IDが出ることを固定する。
 * 中身は現役の子画面の試験が守る。
 */
describe('Googleビジネス子板の印', () => {
  it.each([
    ['performance', null, 'SrmVs'],
    ['profile', null, 'JUTGz'],
    ['profile', 'hours', 'JUTGz'],
    ['profile', 'confirm', 'JUTGz'],
    ['profile', 'history', 'JUTGz'],
    ['posts', null, 'Cfed0'],
    ['posts', 'new', 'T1j2Sw'],
    ['posts', 'confirm', 'T1j2Sw'],
    ['settings', null, 'CuHXG'],
    ['reviews', 'draft', 'x9HIR'],
  ])('tab=%s view=%s → %s', async (tab, view, node) => {
    search.tab = tab
    search.view = view
    render(<GoogleV8 />)
    await screen.findByText('現役の子画面')
    expect(document.querySelector(`[data-design-node="${node}"]`)).not.toBeNull()
  })

  it('未接続は設定の印 CuHXG', async () => {
    search.tab = null
    search.view = null
    fixture.connection.mockResolvedValue({ ...connectionData, connection: { ...connectionData.connection, status: 'new' } })
    render(<GoogleV8 />)
    await screen.findByText('現役の子画面')
    expect(document.querySelector('[data-design-node="CuHXG"]')).not.toBeNull()
  })
})
