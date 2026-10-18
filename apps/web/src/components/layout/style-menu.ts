import type { AccountStyle } from '@line-crm/shared'
import type { MenuItem } from '@/lib/menu'
import { styleTerm } from '@/lib/terms'

/** 表示の初期値だけを絞る。実行権限・サーバーの機能判定には使わない。 */
export function styleMenuItemVisible(item: MenuItem, style: AccountStyle | null, explicitlyConfigured: boolean | null): boolean {
  if (item.required) return true
  if (style === 'restaurant') return true
  if (item.href.startsWith('/restaurant-test') || item.featureKey === 'restaurant_test') return false
  if (!style) return !item.featureKey
  // 旧応答はNENの契約と「未設定=全提供」の既定を区別できない。保存版だけで契約を推測しない。
  if (item.href.startsWith('/nen') || item.featureKey === 'photo_review' || item.featureKey === 'nen_campaigns') return false
  if (item.featureKey === 'ec_commerce' || item.featureKey === 'line_notifications') return style === 'ec'
  // 旧staff読取は保存版を返さない。既存の共通機能を消さず、サーバーが返す可視性で絞る。
  if (explicitlyConfigured !== false) return true
  switch (item.featureKey) {
    case 'booking': return style === 'salon' || style === 'consult' || style === 'lesson'
    case 'events': return style === 'lesson'
    case 'reminders': return style === 'salon' || style === 'consult' || style === 'lesson'
    case 'visit_stamps':
    case 'mileage':
    case 'affiliates':
    case 'webinars':
    case 'multi_store_hierarchy': return false
    default: return true
  }
}

export function styleMenuLabel(item: MenuItem, style: AccountStyle | null): string {
  if (!style) return item.label
  if (item.href === '/events') return styleTerm('lesson', 'V30')
  if (item.href === '/booking/bookings') return styleTerm('standard', 'V30')
  return item.label
}
