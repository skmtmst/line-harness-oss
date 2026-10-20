/** 。販売の説明だけを共用し、APIの上限・対象業種・課金可否は変更しない。 */
import { term } from './terms'
import { PREPARING_WORD } from '@/components/shared/preparing-dialog'
export const PRODUCT_SCOPE = {
  trial: '登録から30日間、提供中の機能を無料で試せます。クレジットカードは不要です。',
  boundaries: `初回の提供は飲食店向けです。画像生成は月20枚までです。予約はLINEの予約と管理に対応します。カードの請求・会議URLの自動発行・Outlook連携は現在${PREPARING_WORD}です。試験の支払いで本当の請求は起きません。LINE公式アカウント側の料金は別です。`,
  estimates: '料金表のアカウント数・ログインユーザー数・通数・容量は利用の目安です。配信できる条件と画像生成の枚数には、現在の制限が適用されます。',
} as const

export function planFeatureLabel(feature: string): string {
  const estimate = /アカウント|ユーザー|権限者|人数|通数|容量|ストレージ|[\d,]+\s*(?:人|名|通|GB|MB)/i.test(feature)
  const label = feature.replace(/権限者/g, term('N08'))
  return estimate && !feature.includes('画像') && !feature.includes('目安') ? `${label}（目安）` : label
}
