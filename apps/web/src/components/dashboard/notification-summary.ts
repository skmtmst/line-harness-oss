import type { NotificationCenterData, NotificationCenterItem } from '@line-crm/shared'
import type { NotificationFilter, NotificationItem } from '@/components/shared/notification-panel'

export type DashboardNotificationFilter = 'all' | 'error' | 'update'

export function isDashboardNotificationData(value: unknown): value is NotificationCenterData {
  if (!value || typeof value !== 'object') return false
  const data = value as Partial<NotificationCenterData>
  const counts = data.counts
  return Array.isArray(data.items)
    && Boolean(counts)
    && Number.isFinite(counts?.all)
    && Number.isFinite(counts?.error)
    && Number.isFinite(counts?.update)
    && Number.isFinite(counts?.unread)
    && Number.isFinite(data.unreadCount)
}

export function dashboardNotificationFilters(
  data: NotificationCenterData | null,
): NotificationFilter[] {
  return [
    { id: 'all', label: 'すべて', count: data?.counts?.all ?? null },
    { id: 'error', label: 'エラー', count: data?.counts?.error ?? null },
    { id: 'update', label: 'アップデート', count: data?.counts?.update ?? null },
  ]
}

function notificationTime(createdAt: string): string {
  const time = new Date(createdAt)
  if (Number.isNaN(time.getTime())) return '日時不明'
  return time.toLocaleString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Tokyo',
  })
}

export function dashboardNotificationItems(
  items: NotificationCenterItem[],
  onSelect: (item: NotificationCenterItem) => void,
): NotificationItem[] {
  return items.map((item) => ({
    id: item.id,
    title: item.title,
    meta: `${item.body}｜${notificationTime(item.createdAt)}`,
    unread: !item.isRead,
    filterId: item.category,
    onSelect: () => onSelect(item),
  }))
}

export function dashboardNotificationDestination(
  item: NotificationCenterItem,
): string | null {
  if (item.eventType.startsWith('account_health_')) return '/emergency'
  if (item.eventType === 'release' || item.eventType.startsWith('deployment_')) return '/updates'
  return null
}

export function markDashboardNotificationRead(
  data: NotificationCenterData,
  notificationId: string,
): NotificationCenterData {
  const target = data.items.find((item) => item.id === notificationId)
  if (!target || target.isRead) return data
  return {
    ...data,
    items: data.items.map((item) => item.id === notificationId ? { ...item, isRead: true } : item),
    counts: {
      ...data.counts,
      unread: Math.max(0, data.counts.unread - 1),
    },
    unreadCount: Math.max(0, data.unreadCount - 1),
  }
}
