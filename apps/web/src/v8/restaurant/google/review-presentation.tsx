import type { GoogleReview } from '@/lib/restaurant-google-api'
import type { StatusBadgeTone } from '@/components/shared/status-badge'
import styles from './google.module.css'

/** 星（★の文字）。評価2以下は赤、ほかは金。 */
export function Stars({ rating, small = false }: { rating: number; small?: boolean }) {
  const safe = Math.max(0, Math.min(5, Math.round(rating)))
  return (
    <span className={`${styles.stars} ${safe <= 2 ? styles.starsLow : ''} ${small ? styles.starsSmall : ''}`} aria-label={`評価 ${safe}／5`} role="img">
      {'★'.repeat(safe) + '☆'.repeat(5 - safe)}
    </span>
  )
}

export function replyBadge(review: GoogleReview): { label: string; tone: StatusBadgeTone } {
  if (review.replyStatus === 'published') return { label: '返信済み', tone: 'success' }
  if (review.replyStatus === 'replied' || review.replyStatus === 'pending_confirm') return { label: '反映確認中', tone: 'warning' }
  if (review.replyStatus === 'draft') return { label: review.replyDraftAiGenerated ? 'AI下書きあり' : '下書きあり', tone: 'info' }
  if (review.needsAttention) return { label: '要確認', tone: 'danger' }
  return { label: '未返信', tone: 'warning' }
}
