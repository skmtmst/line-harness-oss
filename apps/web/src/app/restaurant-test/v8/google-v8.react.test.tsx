// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ snapshot: vi.fn(), connection: vi.fn(), listReviews: vi.fn(), syncReviews: vi.fn() }))
const search = vi.hoisted(() => ({ tab: null as string | null, view: null as string | null }))

vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'account-1', setSelectedAccountId: vi.fn(), accounts: [] }) }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/restaurant-test/google',
  useSearchParams: () => ({ get: (key: string) => (key === 'tab' ? search.tab : key === 'view' ? search.view : null) }),
}))
vi.mock('@/lib/restaurant-test-api', () => ({ restaurantTestApi: { snapshot: fixture.snapshot } }))
vi.mock('@/lib/restaurant-google-api', () => ({
  restaurantGoogleApi: { connection: fixture.connection, listReviews: fixture.listReviews, syncReviews: fixture.syncReviews },
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
const reviews = [
  { id: 'r1', reviewName: 'r1', reviewerDisplayName: '佐藤 S.', starRating: 5, comment: '鹿肉のローストが本当においしかったです。また来ます。', createTime: '2026-09-30T21:40:00+09:00', updateTime: null, needsAttention: false, replyStatus: 'unreplied', replyDraft: null, replyDraftAiGenerated: false, replyDraftGeneratedAt: null, replyComment: null, replyUpdateTime: null, firstSeenAt: '2026-09-30T21:40:00+09:00', updatedAt: '2026-09-30T21:40:00+09:00' },
  { id: 'r2', reviewName: 'r2', reviewerDisplayName: 'M. Tanaka', starRating: 4, comment: 'コースの説明が丁寧でした。', createTime: '2026-09-28T19:30:00+09:00', updateTime: null, needsAttention: false, replyStatus: 'published', replyDraft: null, replyDraftAiGenerated: false, replyDraftGeneratedAt: null, replyComment: 'ありがとうございます。', replyUpdateTime: null, firstSeenAt: '2026-09-28T19:30:00+09:00', updatedAt: '2026-09-28T19:30:00+09:00' },
]

beforeEach(() => {
  search.tab = null
  search.view = null
  fixture.snapshot.mockResolvedValue({ data: { organization: { id: 'org-1', account_id: 'account-1', tenant_id: null, tenant_name: null, name: '組', status: 'active' }, stores: [store] } })
  fixture.connection.mockResolvedValue(connectionData)
  fixture.listReviews.mockResolvedValue({ success: true, reviews, total: 2, page: 1, perPage: 20 })
  fixture.syncReviews.mockResolvedValue({ success: true })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

/*
 * ★V8-B Googleビジネス（板 `j0Wcg`）の契約。
 * 口コミタブの頭・数4・道具の段・表・足元の帯が出て、
 * 下書き画面への行き先が保たれることを固定する。
 */
describe('j0Wcg GoogleビジネスのV8', () => {
  it('数4と表・足元の帯が出る', async () => {
    render(<GoogleV8 />)
    await screen.findByPlaceholderText('口コミを探す')
    const board = document.querySelector('[data-design-node="j0Wcg"]')!
    for (const label of ['未返信', '平均の評価', '要確認', 'Google経由の予約']) {
      expect(board.textContent).toContain(label)
    }
    expect(board.textContent).toContain('4.2')
    expect(board.textContent).toContain('佐藤 S.')
    expect(board.textContent).toContain('下書きを作る')
    expect(board.textContent).toContain('返信を見る')
    expect(board.textContent).toContain('返信文は手で書くか')
  })

  it('状態で絞ると一覧の口へ条件が届く', async () => {
    render(<GoogleV8 />)
    await screen.findByPlaceholderText('口コミを探す')
    await waitFor(() => expect(fixture.listReviews).toHaveBeenCalledWith('account-1', expect.objectContaining({ filter: 'all' })))
    fireEvent.click(screen.getByRole('button', { name: '状態で絞り込み' }))
    const option = await screen.findByRole('option', { name: '状態：未返信' })
    fireEvent.click(option.querySelector('button')!)
    await waitFor(() => expect(fixture.listReviews).toHaveBeenCalledWith('account-1', expect.objectContaining({ filter: 'unreplied' })))
  })
})
