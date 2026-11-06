import type { DashboardCardId } from '@line-crm/shared'

/** 業種に合うカードだけを表示し、保存済みの配置自体は変更しない。 */
export function dashboardCardForStyle(id: DashboardCardId, style: 'standard' | 'ec' | undefined, savedLayout = false): boolean {
  if (!style) return true
  if (style === 'ec' && ['today-bookings', 'booking-status', 'today-shipments'].includes(id)) return false
  if (!savedLayout && (id === 'today-bookings' || id === 'booking-status' || id === 'upcoming')) return false
  if (id === 'today-photo-review') return false
  if (id === 'shipment' || id === 'today-shipments') return style === 'ec'
  return true
}
