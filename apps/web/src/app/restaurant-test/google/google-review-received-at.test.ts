import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { reviewReceivedAt } from '@/v8/restaurant/google/format'

const page = readFileSync(new URL('../../../v8/restaurant/google/reviews.tsx', import.meta.url), 'utf8')
const api = readFileSync(new URL('../../../lib/restaurant-google-api.ts', import.meta.url), 'utf8')

describe('口コミの受信日時', () => {
  it('編集された口コミは編集後の日時を出す', () => {
    expect(reviewReceivedAt({ createTime: '2023-11-11T02:08:00Z', updateTime: '2026-09-20T05:30:00Z' })).toBe('2026-09-20T05:30:00Z')
  })

  it('編集されていない口コミは投稿日時のままにする', () => {
    expect(reviewReceivedAt({ createTime: '2023-11-11T02:08:00Z', updateTime: '2023-11-11T02:08:00Z' })).toBe('2023-11-11T02:08:00Z')
  })

  it('片方が無い・壊れているときも残っている方を出す', () => {
    expect(reviewReceivedAt({ createTime: '2023-11-11T02:08:00Z', updateTime: null })).toBe('2023-11-11T02:08:00Z')
    expect(reviewReceivedAt({ createTime: null, updateTime: '2026-09-20T05:30:00Z' })).toBe('2026-09-20T05:30:00Z')
    expect(reviewReceivedAt({ createTime: '2023-11-11T02:08:00Z', updateTime: 'こわれた値' })).toBe('2023-11-11T02:08:00Z')
    expect(reviewReceivedAt({ createTime: null, updateTime: null })).toBeNull()
  })

  it('一覧・下書き・公開確認のどの日時も受信日時の計算を通す', () => {
    expect(page).toContain('formatShortStamp(reviewReceivedAt(review))')
    // createTime を直接出す箇所を残さない。
    expect(page).not.toContain('formatDateTime(review.createTime)')
    expect(page).not.toContain('formatDate(review.createTime)')
  })
})

describe('AIで下書きを作るボタン', () => {
  it('押すだけで作る。長さや調子を選ばせる口は持たない', () => {
    expect(page).toContain('restaurantGoogleApi.generateDraft(accountId, reviewId)')
    expect(api).toContain('generateDraft: (accountId: string, id: string)')
    for (const gone of ['shorter', 'polite', 'baseText', '短くする', '丁寧にする']) {
      expect(api).not.toContain(gone)
      expect(page).not.toContain(gone)
    }
  })
})
