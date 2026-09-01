import { describe, expect, it } from 'vitest'
import { formatCampaignTiming, formatNenJobDateTime } from './campaign-display'

describe('NEN配信の表示', () => {
  it('誕生日配信を発送後の負の日数として表示しない', () => {
    expect(formatCampaignTiming({
      campaignKey: 'birthday_coupon',
      delayDays: -3,
      // 保存済みの値に関係なく、実行処理は毎日10:00固定。
      deliveryTime: '18:30',
    })).toBe('誕生日の3日前 10:00')
  })

  it('購入後フォローはこれまでどおり発送完了からの日数を表示する', () => {
    expect(formatCampaignTiming({
      campaignKey: 'arrival_check',
      delayDays: 5,
      deliveryTime: '10:00',
    })).toBe('発送完了から5日後 10:00')
  })

  it('UTCの予定時刻を日本時間へ変換し、壊れた日時を生表示しない', () => {
    expect(formatNenJobDateTime('2026-08-25T11:00:00.000Z')).toBe('2026/08/25 20:00')
    expect(formatNenJobDateTime('broken')).toBe('日時を確認できません')
  })
})
