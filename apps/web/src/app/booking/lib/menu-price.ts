import type { BookingMenu } from '@/lib/api'
import { formatNumber } from '@/lib/format'

/**
 * 予約メニューの料金表示（R309）。
 *
 * 一覧・担当割当表・スタッフ追加の候補で同じ言葉にする。
 * `base_price` だけ見ると「お問い合わせ」（金額0）が「¥0」＝無料に見える。
 * 料金の形（`price_mode`）を先に見て、お問い合わせ・無料・固定料金を分ける。
 */
export function menuPriceLabel(menu: Pick<BookingMenu, 'price_mode' | 'base_price'>): string {
  if (menu.price_mode === 'inquiry') return 'お問い合わせ'
  return menu.base_price === 0 ? '無料' : `¥${formatNumber(menu.base_price)}`
}
