import type { GooglePost } from '@/lib/restaurant-google-api'
import type { StatusBadgeTone } from '@/components/shared/status-badge'
export function statusBadge(post: GooglePost): { label: string; tone: StatusBadgeTone } {
  switch (post.status) {
    case 'draft': return { label: '下書き', tone: 'neutral' }
    case 'scheduled': return { label: '予約中', tone: 'info' }
    case 'pending_confirm': return { label: '送信確認中', tone: 'warning' }
    case 'accepted': return { label: '審査中', tone: 'info' }
    case 'published': return { label: '公開済み', tone: 'success' }
    case 'rejected': return { label: 'Googleで不承認', tone: 'danger' }
    case 'failed': return { label: '送信失敗', tone: 'danger' }
    case 'cancelled': return { label: '取消済み', tone: 'neutral' }
    case 'deleted': return { label: '削除済み', tone: 'neutral' }
  }
}
