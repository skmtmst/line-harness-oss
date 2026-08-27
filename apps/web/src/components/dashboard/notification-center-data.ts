import type {
  NotificationCenterData,
  NotificationCenterItem,
} from '@line-crm/shared'
import type {
  NotificationFilter,
  NotificationItem,
} from '@/components/shared/notification-panel'

export function dashboardNotificationFilters(
  data: NotificationCenterData | null,
): NotificationFilter[] {
  return [
    { id: 'all', label: 'すべて', count: data?.counts.all ?? 0 },
    { id: 'error', label: 'エラー', count: data?.counts.error ?? 0 },
    { id: 'update', label: 'アップデート', count: data?.counts.update ?? 0 },
  ]
}

export function dashboardNotificationDestination(
  item: NotificationCenterItem,
): string | null {
  if (item.eventType.startsWith('account_health_')) return '/emergency'
  if (item.eventType === 'release' || item.eventType.startsWith('deployment_')) return '/updates'
  return null
}

export function dashboardNotificationItems(
  data: NotificationCenterData | null,
  onSelect: (item: NotificationCenterItem) => void,
): NotificationItem[] {
  return (data?.items ?? []).map((item) => ({
    id: item.id,
    title: item.title,
    meta: item.body,
    unread: !item.isRead,
    filterId: item.category === 'error' || item.category === 'update'
      ? item.category
      : 'all',
    onSelect: () => onSelect(item),
  }))
}

export function markDashboardNotificationRead(
  data: NotificationCenterData | null,
  notificationId: string,
): NotificationCenterData | null {
  if (!data) return null
  const target = data.items.find((item) => item.id === notificationId)
  if (!target || target.isRead) return data
  return {
    ...data,
    items: data.items.map((item) => item.id === notificationId ? { ...item, isRead: true } : item),
    counts: { ...data.counts, unread: Math.max(0, data.counts.unread - 1) },
    unreadCount: Math.max(0, data.unreadCount - 1),
  }
}
