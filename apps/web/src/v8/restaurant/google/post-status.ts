import type { GooglePost } from '@/lib/restaurant-google-api'
import type { StatusBadgeTone } from '@/components/shared/status-badge'
import { GOOGLE_POST_STATUS } from '@/lib/status-labels'

/** 投稿の状態の札。言葉と色は言葉の表（lib/status-labels）にあり、ここでは引くだけ。 */
export function statusBadge(post: GooglePost): { label: string; tone: StatusBadgeTone } {
  return GOOGLE_POST_STATUS[post.status]
}
