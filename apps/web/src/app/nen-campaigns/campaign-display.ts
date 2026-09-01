import type { NenCampaignSetting } from '@/lib/api'

type TimingSetting = Pick<NenCampaignSetting, 'campaignKey' | 'delayDays' | 'deliveryTime'>

/** 配信の実際の起点を、発送後と誕生日で言い分ける。 */
export function formatCampaignTiming(setting: TimingSetting): string {
  if (setting.campaignKey === 'birthday_coupon') {
    return '誕生日の3日前 10:00'
  }
  return setting.delayDays === 0
    ? 'イベント発生後すぐ'
    : `発送完了から${setting.delayDays}日後 ${setting.deliveryTime}`
}

/** APIのUTC日時を、運用者が判断に使う日本時間へ変える。 */
export function formatNenJobDateTime(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '日時を確認できません'
  return date.toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Tokyo',
  })
}
