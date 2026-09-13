import { describe, expect, it } from 'vitest'

import { photoReviewEntryFrom, photoReviewStatusFrom } from './photo-review-query'

/*
 * #666 N-004: 深掘りのURLの読み方。実画面での効き目は
 * photo-review-deep-link-react.test.tsx で見る。ここは境目の値だけ。
 */
describe('深掘りURLの読み取り(#666)', () => {
  it('APIの言い方も画面の言い方も同じ札へ寄せる', () => {
    for (const raw of ['pending_review', 'pending-review', 'pending', 'PENDING_REVIEW', ' pending ']) {
      expect(photoReviewStatusFrom(raw)).toBe('pending')
    }
    expect(photoReviewStatusFrom('adopted')).toBe('adopted')
    expect(photoReviewStatusFrom('approved')).toBe('adopted')
    expect(photoReviewStatusFrom('rejected')).toBe('rejected')
    expect(photoReviewStatusFrom('returned')).toBe('rejected')
  })

  it('知らない値・空は null（既定へ落とすのは呼ぶ側）', () => {
    expect(photoReviewStatusFrom('')).toBeNull()
    expect(photoReviewStatusFrom(null)).toBeNull()
    expect(photoReviewStatusFrom(undefined)).toBeNull()
    expect(photoReviewStatusFrom('deleted')).toBeNull()
  })

  it('ダッシュボードが出すURLは、写真の一覧と審査待ちの札になる', () => {
    expect(photoReviewEntryFrom('?tab=photos&status=pending_review'))
      .toEqual({ view: 'list', status: 'pending' })
    // 先頭の ? はあってもなくても同じ。
    expect(photoReviewEntryFrom('tab=photos&status=pending_review'))
      .toEqual({ view: 'list', status: 'pending' })
  })

  it('掲載の札も開ける。状態の指定はそのまま持ち越す', () => {
    expect(photoReviewEntryFrom('?tab=publications'))
      .toEqual({ view: 'publications', status: 'pending' })
    expect(photoReviewEntryFrom('?tab=published&status=adopted'))
      .toEqual({ view: 'publications', status: 'adopted' })
  })

  it('指定なし・壊れた指定は、今までどおり一覧の「見ていないもの」', () => {
    for (const search of ['', null, undefined, '?', '?tab=&status=', '?tab=unknown&status=unknown']) {
      expect(photoReviewEntryFrom(search)).toEqual({ view: 'list', status: 'pending' })
    }
  })
})
