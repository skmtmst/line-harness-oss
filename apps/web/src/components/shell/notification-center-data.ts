import type { NotificationCenterData, NotificationCenterItem } from '@line-crm/shared'
import type { api } from '@/lib/api'
import { isDashboardNotificationData } from '@/components/dashboard/notification-summary'

export type NotificationAccount = { id: string; label: string }
export type NotificationScope = { kind: 'all' } | { kind: 'store'; accountId: string } | { kind: 'none' }
export type ScopedNotification = NotificationCenterItem & { sourceAccountId: string; sourceAccountName: string }
export type ScopedCenterData = Omit<NotificationCenterData, 'items' | 'unreadCount'> & {
  items: ScopedNotification[]
  unreadCount: number | null
  failedAccountLabels: string[]
  loadedAccountIds: string[]
}

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
  const results = await Promise.allSettled(targets.map(async (account) => {
    const response = await api.notifications.center.list(account.id, query)
    if (!response.success) throw new Error(response.error)
    if (!isDashboardNotificationData(response.data)) throw new Error('invalid notification center response')
    return { account, data: response.data }
  }))
  const responses = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : [])
  const failedAccountLabels = results.flatMap((result, index) => result.status === 'rejected'
    ? [targets[index]?.label.trim() || '一部の店舗']
    : [])
  if (responses.length === 0) {
    const firstFailure = results.find((result) => result.status === 'rejected')
    throw firstFailure?.status === 'rejected' ? firstFailure.reason : new Error('通知を読み込めませんでした。')
  }
  const items = responses.flatMap(({ account, data }) => data.items.map((item) => ({
    ...item, sourceAccountId: account.id, sourceAccountName: account.label,
  })))
  const counts = responses.reduce((sum, { data }) => ({
    all: sum.all + data.counts.all,
    error: sum.error + data.counts.error,
    update: sum.update + data.counts.update,
    unread: sum.unread + data.unreadCount,
  }), { all: 0, error: 0, update: 0, unread: 0 })
  return {
    items,
    counts,
    unreadCount: failedAccountLabels.length === 0 ? counts.unread : null,
    failedAccountLabels: [...new Set(failedAccountLabels)],
    loadedAccountIds: responses.map(({ account }) => account.id),
  }
}
