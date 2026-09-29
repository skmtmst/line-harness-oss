import { describe, expect, it } from 'vitest'
import { formatPhotoReceivedAt } from './photo-review-time'

describe('写真審査の受信日時', () => {
  it('UTCの日時を日本時間で表示する', () => {
    expect(formatPhotoReceivedAt('2026-08-22T09:22:00.000Z')).toBe('2026/08/22 18:22')
  })

  it('タイムゾーンオフセット付きISO日時を日本時間へ変換し日付をまたぐ', () => {
    expect(formatPhotoReceivedAt('2026-08-22T16:30:00-07:00')).toBe('2026/08/23 08:30')
  })

  it('読めない日時を元文字列のまま見せない', () => {
    expect(formatPhotoReceivedAt('not-a-date')).toBe('—')
    expect(formatPhotoReceivedAt(null)).toBe('—')
  })
})
