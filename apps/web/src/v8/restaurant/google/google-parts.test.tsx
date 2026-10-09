// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ review: vi.fn(), listReviews: vi.fn(), createPost: vi.fn(), profile: vi.fn(), role: 'owner' }))
vi.mock('@/lib/restaurant-google-api', () => ({ restaurantGoogleApi: { review: fixture.review, listReviews: fixture.listReviews, createPost: fixture.createPost, profile: fixture.profile } }))
vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => fixture.role, canManageRole: (role: string) => role === 'owner' || role === 'admin' }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => '/restaurant-test/google', useSearchParams: () => new URLSearchParams() }))
import { compareText } from './performance'
import { formatShortStamp, formatYmd } from './format'
import { PostEditor } from './posts'
import { ReviewDraft, ReviewsBoard } from './reviews'
import ProfileBoard from './profile'
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
afterEach(() => { cleanup(); vi.resetAllMocks(); fixture.role = 'owner' })

it('閲覧のみのプロフィールでは変更操作を隠し、営業時間は読める', async () => {
  fixture.role = 'viewer'
  fixture.profile.mockResolvedValue({
    profile: { title: '試験店', specialHours: [], regularHours: [], phoneNumbers: {}, address: null },
    today: { date: '2026-10-09', closed: false, periods: [{ open: '11:00', close: '20:00' }] },
    holidays: [], closed: false, googleUpdates: null, photoCount: null,
  })
  render(<ProfileBoard accountId="a" go={vi.fn()} />)
  expect(await screen.findByText(/11:00.*20:00/)).toBeTruthy()
  for (const name of ['営業時間を変更', '今日を休みにする', '今日は早く閉める', 'プロフィールを編集']) {
    expect(screen.queryByRole('button', { name })).toBeNull()
  }
})

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


describe('投稿フォームの入力と保存', () => {
  it('空の本文は欄で知らせてフォーカスを移し、保存先へ送らない', async () => {
    render(<PostEditor accountId="a" kind="standard" postId={null} go={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '下書きを保存する' }))
    const input = screen.getByLabelText('本文')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(input)
    expect(screen.getAllByText('本文を入力してください。')).toHaveLength(1)
    expect(fixture.createPost).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: '営業しています。' } })
    expect(input.getAttribute('aria-invalid')).not.toBe('true')
  })
  it('特典の入力不足は最初のタイトル欄へ移し、期間の誤りも各欄に結び付ける', () => {
    render(<PostEditor accountId="a" kind="offer" postId={null} go={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '公開内容を確認' }))
    expect(document.activeElement).toBe(screen.getByLabelText('タイトル（特典・イベントのとき）'))
    for (const label of ['期間 はじめ', '期間 おわり']) {
      const field = screen.getByLabelText(label)
      expect(field.getAttribute('aria-invalid')).toBe('true')
      const errorIds = field.getAttribute('aria-describedby')?.split(' ') ?? []
      expect(errorIds.some((id) => document.getElementById(id)?.getAttribute('role') === 'alert')).toBe(true)
    }
    expect(fixture.createPost).not.toHaveBeenCalled()
  })
  it('保存失敗でも本文を残し、通信の失敗だけを帯で知らせる', async () => {
    fixture.createPost.mockRejectedValue(new Error('保存に失敗しました'))
    const go = vi.fn()
    render(<PostEditor accountId="a" kind="standard" postId={null} go={go} />)
    const input = screen.getByLabelText('本文') as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: '営業しています。' } })
    fireEvent.click(screen.getByRole('button', { name: '下書きを保存する' }))
    await waitFor(() => expect(screen.getByText('下書きを保存できませんでした。')).toBeTruthy())
    expect(input.value).toBe('営業しています。')
    expect(fixture.createPost).toHaveBeenCalledWith('a', expect.objectContaining({ summary: '営業しています。' }))
    expect(go).not.toHaveBeenCalled()
  })
})

it('WEB176：平均と件数は期間集計ではなく総合と表示する', async () => {
  fixture.listReviews.mockResolvedValue({ total: 0, perPage: 20, items: [] });
  const data = connection(true, true);
  data.connection.averageRating = 4.5;
  data.connection.totalReviewCount = 42;
  render(<ReviewsBoard accountId="a" data={data} go={vi.fn()} onSynced={vi.fn()} />);
  expect(screen.getByText('総合・42件')).toBeTruthy();
  expect(screen.queryByText('この30日・42件')).toBeNull();
});
