import { describe, expect, it } from 'vitest'

import {
  formatPublicationDate,
  publicationStateLabel,
} from './publication-label'

describe('公開状態の日本語表示の契約', () => {
  it('5つの公開状態を同じ言葉で返す', () => {
    expect(publicationStateLabel('always', null, null)).toBe('常時公開')
    expect(publicationStateLabel('ended', null, null)).toBe('公開終了')
    expect(publicationStateLabel('unset', null, null)).toBe('未設定')
  })

  it('予約公開は開始日時を時刻付きで返す', () => {
    expect(publicationStateLabel('scheduled', '2026-08-28T20:00:00+09:00', null))
      .toBe('8/28 20:00')
  })

  it('期間公開は開始〜終了を返す', () => {
    expect(publicationStateLabel('period', '2026-08-01T00:00:00+09:00', '2026-08-31T23:59:59+09:00'))
      .toBe('8/1〜8/31')
  })

  it('決まらない状態・壊れた日付は各画面の落としどころへ返す', () => {
    /* 未対応の状態は null。画面側の fallback(配信枠・毎日・未設定)が引き受ける。 */
    expect(publicationStateLabel('archived', null, null)).toBeNull()
    expect(publicationStateLabel(null, null, null)).toBeNull()
    expect(publicationStateLabel(undefined, null, null)).toBeNull()
    /* 期間の片方が壊れていても5枝では決めない。 */
    expect(publicationStateLabel('period', 'not-a-date', '2026-08-31T23:59:59+09:00')).toBeNull()
  })

  it('壊れた日時は元の文字列を出さず null にする', () => {
    expect(formatPublicationDate('not-a-date')).toBeNull()
    expect(formatPublicationDate(null)).toBeNull()
    expect(formatPublicationDate(undefined)).toBeNull()
  })
})
