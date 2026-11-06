import type { StatusBadgeTone } from '@/components/shared/status-badge'
export const statusTone: Record<string, StatusBadgeTone> = {
  requested: 'warning',
  confirmed: 'success',
  completed: 'neutral',
  no_show: 'danger',
  cancelled: 'danger',
  rejected: 'neutral',
  expired: 'neutral',
}
