// @vitest-environment happy-dom
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ review: vi.fn() }))
vi.mock('@/lib/restaurant-google-api', () => ({ restaurantGoogleApi: { review: fixture.review } }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => '/restaurant-test/google', useSearchParams: () => new URLSearchParams() }))
import { compareText } from './performance'
import { formatShortStamp, formatYmd } from './format'
import { ReviewDraft } from './reviews'
import type { GoogleConnectionData } from '@/lib/restaurant-google-api'

const review = {
  id: 'rv-2', reviewName: 'r', reviewerDisplayName: 'Kenji', starRating: 2, comment: '待ちました。', createTime: '2026-09-30T11:12:00Z', updateTime: null,
  needsAttention: true, replyStatus: 'unreplied', replyDraft: '下書き', replyDraftAiGenerated: false, replyDraftGeneratedAt: null, replyComment: null, replyUpdateTime: null,
  firstSeenAt: '2026-09-30T11:12:00Z', updatedAt: '2026-09-30T11:12:00Z',
}
const connection = (writeEnabled: boolean, canPublishReply: boolean) => ({
  success: true, store: { id: 's', name: '試験店', lineAccountId: 'a' }, connection: { status: 'connected', locationTitle: '試験店', locationMapsUrl: null },
  candidates: [], summary: { unrepliedCount: 0, draftCount: 0, attentionCount: 0, newCount: 0, storedCount: 0, postsAttentionCount: 0, syncStale: false },
  writeEnabled, oauthConfigured: true, aiAvailable: true, permissions: { canManageConnection: true, canPublishReply },
}) as unknown as GoogleConnectionData

beforeEach(() => { fixture.review.mockResolvedValue({ success: true, review, store: { id: 's', name: '試験店' }, connection: {} }) })
afterEach(() => { cleanup(); vi.resetAllMocks() })

describe('Googleビジネスの表示の道具', () => {
  it('前期比は「前の28日より +12%」、下がったら「−3%」、比べられないときは「—」', () => {
    expect(compareText(28, 1820, 1625)).toBe('前の28日より +12%')
    expect(compareText(28, 38, 39)).toBe('前の28日より −3%')
    expect(compareText(7, 10, 0)).toBe('前の7日より —')
    expect(compareText(7, null, 3)).toBe('前の7日より —')
  })
  it('日時は店舗の時刻（日本時間）で出す', () => {
    expect(formatShortStamp('2026-09-30T11:12:00Z')).toBe('9/30 20:12')
    expect(formatYmd('2026-09-12T01:20:00Z')).toBe('2026/09/12')
    expect(formatShortStamp(null)).toBe('—')
  })
})

describe('返信を作る：送れない設定のときは送信へ進むボタンを出さない', () => {
  it('検証環境（writeEnabled=false）では「返信内容を確認」を置かず、下書きの保存はできる', async () => {
    render(<ReviewDraft accountId="a" reviewId="rv-2" data={connection(false, true)} go={vi.fn()} onPublished={vi.fn()} />)
    expect(await screen.findByRole('button', { name: '下書きを保存する' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '返信内容を確認' })).toBeNull()
    expect(screen.getByText('検証環境では Google へは送りません。下書きと承認まで。')).toBeTruthy()
  })
  it('送れる設定で公開の権限があれば「返信内容を確認」を出す', async () => {
    render(<ReviewDraft accountId="a" reviewId="rv-2" data={connection(true, true)} go={vi.fn()} onPublished={vi.fn()} />)
    expect(await screen.findByRole('button', { name: '返信内容を確認' })).toBeTruthy()
  })
})
