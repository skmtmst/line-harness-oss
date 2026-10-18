import type { DashboardCardId } from '@line-crm/shared'

/** EC以外で注文・出荷・NEN専用カードを見せない。保存済みの配置自体は変更しない。 */
export function dashboardCardForStyle(id: DashboardCardId, style: 'standard' | 'ec' | undefined, savedLayout = false): boolean {
  if (!style) return true
  if (!savedLayout && (id === 'today-bookings' || id === 'booking-status' || id === 'upcoming')) return false
  if (id === 'today-photo-review') return false
  if (id === 'shipment' || id === 'today-shipments') return style === 'ec'
  return true
}
