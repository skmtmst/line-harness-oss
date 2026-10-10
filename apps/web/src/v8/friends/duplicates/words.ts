/* ★V8 重複検出の言葉（hn6Y8・fcg2D）。 */
import type { IdentityCandidateStatus, IdentityConfidenceLabel } from '@line-crm/shared'
import { formatDate as polishFormatDate } from '@/lib/format'


export const CONFIDENCE_WORD: Record<IdentityConfidenceLabel, string> = { very_high: '最高', high: '高', medium: '中', low: '低' }

export const STATUS_WORD: Record<IdentityCandidateStatus, string> = {
  pending: '未確認',
  linked: '結び付けた',
  different: '別人',
  deferred: '保留',
  invalidated: '無効',
}

/** 状態の札（絵の順：すべて・未確認・保留・結び付けた・別人）。値は今の API と同じ。 */
export const STATUS_FILTERS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '', label: 'すべて' },
  { value: 'pending', label: '未確認' },
  { value: 'deferred', label: '保留' },
  { value: 'linked', label: '結び付けた' },
  { value: 'different', label: '別人' },
]

export type PillTone = 'ok' | 'warn' | 'muted'

export function confidenceTone(label: IdentityConfidenceLabel): PillTone {
  return label === 'very_high' || label === 'high' ? 'ok' : 'muted'
}

export function statusTone(status: IdentityCandidateStatus): PillTone {
  if (status === 'pending') return 'warn'
  if (status === 'linked') return 'ok'
  return 'muted'
}

/** 8/30 19:00（日本時間）。 */
export function slashDateTime(iso: string): string {
  return polishFormatDate(iso, { style: 'list', fallback: '—' })
}
