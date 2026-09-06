import { describe, expect, it } from 'vitest'
import { formatCampaignContent, formatCampaignTiming, formatNenJobDateTime } from './campaign-display'

describe('NEN配信の表示', () => {
  it('誕生日配信を発送後の負の日数として表示しない', () => {
    expect(formatCampaignTiming({
      campaignKey: 'birthday_coupon',
      delayDays: -3,
      // 保存済みの値に関係なく、実行処理は毎日10:00固定。
      deliveryTime: '18:30',
    })).toBe('誕生日の3日前 10:00')
  })

  it('購入後フォローは注文からの実際の段階を表示する', () => {
    expect(formatCampaignTiming({
      campaignKey: 'arrival_check',
      delayDays: 1,
      deliveryTime: '10:00',
    })).toBe('到着の翌日 10:00')
    expect(formatCampaignTiming({
      campaignKey: 'review_request',
      delayDays: 7,
      deliveryTime: '20:00',
    })).toBe('到着から7日後 20:00')
  })

  it('配信キーに対応する中身の種類を表示する', () => {
    expect(formatCampaignContent({ campaignKey: 'arrival_check', buttonLabel: '見る' })).toBe('カルーセル 3枚')
    expect(formatCampaignContent({ campaignKey: 'care_check', buttonLabel: '答える' })).toBe('質問（2択）')
    expect(formatCampaignContent({ campaignKey: 'unknown', buttonLabel: null })).toBe('テキスト')
  })

  it('UTCの予定時刻を日本時間へ変換し、壊れた日時を生表示しない', () => {
    expect(formatNenJobDateTime('2026-08-25T11:00:00.000Z')).toBe('2026/08/25 20:00')
    expect(formatNenJobDateTime('broken')).toBe('日時を確認できません')
  })
})
