import type { NotificationCenterData, NotificationCenterItem } from '@line-crm/shared'
import type { api } from '@/lib/api'
import { isDashboardNotificationData } from '@/components/dashboard/notification-summary'

export type NotificationAccount = { id: string; label: string }
export type NotificationScope = { kind: 'all' } | { kind: 'store'; accountId: string } | { kind: 'none' }
export type ScopedNotification = NotificationCenterItem & { sourceAccountId: string; sourceAccountName: string }
export type ScopedCenterData = Omit<NotificationCenterData, 'items'> & { items: ScopedNotification[] }

/** ベルの札と小窓は、同じ対象・同じ未読の数を使う。取得失敗は0件にしない。 */
export async function loadNotificationCenter(
  scope: NotificationScope,
  accounts: NotificationAccount[],
  query: Parameters<typeof api.notifications.center.list>[1],
): Promise<ScopedCenterData | null> {
  const targets = scope.kind === 'none' ? [] : scope.kind === 'all' ? accounts
    : [accounts.find((account) => account.id === scope.accountId) ?? { id: scope.accountId, label: '' }]
  if (targets.length === 0) return null
  const { api } = await import('@/lib/api')
  const responses = await Promise.all(targets.map(async (account) => {
    const response = await api.notifications.center.list(account.id, query)
    if (!response.success) throw new Error(response.error)
    if (!isDashboardNotificationData(response.data)) throw new Error('invalid notification center response')
    return { account, data: response.data }
  }))
  const items = responses.flatMap(({ account, data }) => data.items.map((item) => ({
    ...item, sourceAccountId: account.id, sourceAccountName: account.label,
  })))
  const counts = responses.reduce((sum, { data }) => ({
    all: sum.all + data.counts.all,
    error: sum.error + data.counts.error,
    update: sum.update + data.counts.update,
    unread: sum.unread + data.unreadCount,
  }), { all: 0, error: 0, update: 0, unread: 0 })
  return { items, counts, unreadCount: counts.unread }
}
