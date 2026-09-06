import type { NenCampaignSetting } from '@/lib/api'

type TimingSetting = Pick<NenCampaignSetting, 'campaignKey' | 'delayDays' | 'deliveryTime'>
type ContentSetting = Pick<NenCampaignSetting, 'campaignKey' | 'buttonLabel'>

const timingByCampaign: Record<string, string> = {
  order_thanks: '注文の確定ですぐ',
  shipping_notice: '発送を登録した当日',
  arrival_check: '到着の翌日 10:00',
  care_check: '到着から3日後 19:00',
  review_request: '到着から7日後 20:00',
  cross_sell: '到着から30日後',
  birthday_coupon: '誕生日の3日前 10:00',
}

const contentByCampaign: Record<string, string> = {
  order_thanks: 'テキスト＋注文の明細',
  shipping_notice: 'テキスト＋追跡リンク',
  arrival_check: 'カルーセル 3枚',
  care_check: '質問（2択）',
  review_request: 'リッチメッセージ',
  cross_sell: 'テキスト＋クーポン',
  birthday_coupon: 'テキスト＋クーポン',
}

/** 配信の実際の起点を、発送後と誕生日で言い分ける。 */
export function formatCampaignTiming(setting: TimingSetting): string {
  const known = timingByCampaign[setting.campaignKey]
  if (known) return known
  return setting.delayDays === 0
    ? 'イベント発生後すぐ'
    : `発送完了から${setting.delayDays}日後 ${setting.deliveryTime}`
}

/** 配信キーで中身の種類が決まるものは、リンク有無だけに丸めず運用名で示す。 */
export function formatCampaignContent(setting: ContentSetting): string {
  return contentByCampaign[setting.campaignKey] ?? (setting.buttonLabel ? 'テキスト＋リンク' : 'テキスト')
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
