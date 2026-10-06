import type { NotificationCenterItem } from '@line-crm/shared'
import { dashboardNotificationDestination } from '@/components/dashboard/notification-summary'

/*
 * 通知の行き先。ダッシュボードの通知パネルと同じ判定（dashboardNotificationDestination）に、
 * EC連携の通知（`ec.` / `ec_` で始まる種類）だけ EC連携の画面へ送る分を足す。
 * 今までは EC連携の通知も「お知らせ一覧」へ行っていた（直す場所へ1回で行けなかった）。
 */
export function notificationDestination(item: NotificationCenterItem): string {
  if (item.eventType.startsWith('ec.') || item.eventType.startsWith('ec_')) return '/ec-commerce'
  return dashboardNotificationDestination(item)
}

/** 行の右に出す「どこへ移るか」の言葉（絵 y8QQV の「EC連携を開く →」など）。 */
export function notificationLinkLabel(item: NotificationCenterItem): string {
  const to = notificationDestination(item)
  if (to.startsWith('/ec-commerce')) return 'EC連携を開く'
  if (to.startsWith('/emergency')) return '運用状態を開く'
  if (to.startsWith('/broadcasts')) return '配信を開く'
  if (to.startsWith('/settings/manual-links')) return 'マニュアルの表を開く'
  // メンテナンスの予告は版の履歴ではないので「詳細を見る」（行き先は同じお知らせ一覧）。
  if (to.startsWith('/updates') && item.category === 'update' && !item.eventType.includes('maintenance')) return '更新履歴を見る'
  return '詳細を見る'
}
