import { describe, expect, it } from 'vitest'
import { reminderPlaceholders, renderReminderBodySample } from './reminder-labels'

/*
 * R16 の見本表示の再発防止。本文の下と LINE プレビューは
 * 同じ見本値で読んだ文を出す。実装に無い変数名はそのまま残す
 * (置き換わらずに届くので、あるように見せない)。
 */

const SETTINGS = {
  name: '予約前のお知らせ',
  description: null,
  lineAccountId: 'account-1',
  triggerType: 'booking',
  deliveryMode: 'time',
  steps: [],
} as never

describe('本文の見本表示', () => {
  it('名前を見本の値で読む', () => {
    expect(renderReminderBodySample('{{name}}さん、こんにちは')).toBe('山田花子さん、こんにちは')
  })

  it('日時の書き方を見本の日で読む', () => {
    expect(renderReminderBodySample('明日は{{date}}です')).toBe('明日は10月1日(木)です')
    expect(renderReminderBodySample('{{date:ymd}}にお越しください')).toBe('2026年10月1日にお越しください')
    expect(renderReminderBodySample('{{date+7}}まで有効です')).toBe('10月8日(木)まで有効です')
  })

  it('目標日までの日数を見本で読む', () => {
    expect(renderReminderBodySample('あと{{days_until:2026-10-04}}です')).toBe('あとあと3日です')
  })

  it('友だち情報・共通情報を区別した見本で読む', () => {
    expect(renderReminderBodySample('{{field.pet_name}}ちゃん')).toBe('見本の登録値ちゃん')
    expect(renderReminderBodySample('{{var.shop_tel}}まで')).toBe('見本の共通値まで')
  })

  it('実装に無い変数名はそのまま残す', () => {
    expect(renderReminderBodySample('{{meet_datetime}}に集合')).toBe('{{meet_datetime}}に集合')
  })

  it('個別相談の予約日時とMeet URLを見本で読む', () => {
    expect(renderReminderBodySample('{{reservation_datetime}}にお待ちしています')).toBe(
      '10月1日(木) 10:00にお待ちしています',
    )
    expect(renderReminderBodySample('参加はこちら{{meet_url}}')).toBe(
      '参加はこちらhttps://meet.google.com/sample-0000',
    )
  })

  it('確認表は日時の書き方・先の日付を落とさない', () => {
    const settings = {
      ...SETTINGS,
      steps: [{ messageContent: '{{date:ymd}}に{{date+7}}まで、あと{{days_until:2026-10-04}}です' }],
    } as never
    const tokens = reminderPlaceholders(settings, null).map((placeholder) => placeholder.token)
    expect(tokens).toContain('{{date:ymd}}')
    expect(tokens).toContain('{{date+7}}')
    expect(tokens).toContain('{{days_until:2026-10-04}}')
  })

  it('確認表は実装に無い変数名を拾わない', () => {
    const settings = {
      ...SETTINGS,
      steps: [{ messageContent: '{{meet_datetime}}に集合' }],
    } as never
    expect(reminderPlaceholders(settings, null)).toHaveLength(0)
  })

  it('確認表は個別相談の差し込みを取得元付きで拾う', () => {
    const settings = {
      ...SETTINGS,
      steps: [{ messageContent: '{{reservation_datetime}}に{{meet_url}}から' }],
    } as never
    const rows = reminderPlaceholders(settings, null)
    expect(rows.map((row) => row.token)).toEqual(['{{reservation_datetime}}', '{{meet_url}}'])
    expect(rows.map((row) => row.source)).toEqual(['個別相談の予約日時', '個別相談のMeet URL'])
  })
})
