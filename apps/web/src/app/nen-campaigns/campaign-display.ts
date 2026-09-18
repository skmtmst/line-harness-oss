import type { NenCampaignSetting } from '@/lib/api'

type TimingSetting = Pick<NenCampaignSetting, 'campaignKey' | 'delayDays' | 'deliveryTime'>
type ContentSetting = Pick<NenCampaignSetting, 'campaignKey' | 'buttonLabel'>

/*
 * NEN表示キー(#728)。実キー5つだけを持つ。order_thanks / shipping_notice /
 * care_check は出さない・止めたキーで、column は種データ由来の実キー。
 *
 * worker 側の CAMPAIGN_KEYS から導けない。CAMPAIGN_KEYS はサーバ側正本で
 * 所有外のため触れず、shared への移動も範囲外。実キーが変わったら
 * ここも手で揃える。4者突合の試験が、実口・型・見本とのずれを捕まえる。
 */
const timingByCampaign: Record<string, string> = {
  arrival_check: '到着の翌日 10:00',
  review_request: '到着から7日後 20:00',
  cross_sell: '到着から30日後',
  column: '予約した日時',
  birthday_coupon: '誕生日の3日前 10:00',
}

const contentByCampaign: Record<string, string> = {
  arrival_check: 'カルーセル 3枚',
  review_request: 'リッチメッセージ',
  cross_sell: 'テキスト＋クーポン',
  column: '紹介文＋コラム',
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

/*
 * ★V6 37-6（`z4q1K`）「対象」列。だれに届く配信かを、実キーごとに運用の言葉で示す。
 * 実キーは上と同じ5つ。増えたらここも手で揃える。
 */
const audienceByCampaign: Record<string, string> = {
  arrival_check: '注文した会員',
  review_request: '注文した会員',
  cross_sell: '注文した会員',
  column: '友だち 全員',
  birthday_coupon: '誕生日を登録したペットの飼い主',
}

export function formatCampaignAudience(setting: Pick<NenCampaignSetting, 'campaignKey' | 'category'>): string {
  return audienceByCampaign[setting.campaignKey] ?? (setting.category === 'birthday' ? 'ペットを登録した会員' : '注文した会員')
}

/** ★V6 37-6 「きっかけ」の絞り込み。実キーの category を運用の言葉にする。 */
export const campaignTriggerLabel: Record<NenCampaignSetting['category'], string> = {
  transactional: '注文・発送',
  follow_up: '注文のあと',
  column: 'コラム',
  birthday: 'ペットの誕生日',
}
