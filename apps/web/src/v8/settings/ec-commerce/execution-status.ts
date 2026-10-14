import type { EcFailureKind, EcActionExecutionStatus } from '@/lib/api'
import type { StatusBadgeTone } from '@/components/shared/status-badge'

/* 失敗・見送りの分類（app/ec-commerce/ec-failure.ts の写し。表示語だけ）。 */
export const FAILURE_KIND_LABEL: Record<EcFailureKind, string> = {
  unlinked: '未連携',
  not_following: 'フォロー外',
  permission: '権限・認証',
  communication: '通信の失敗',
  rejected: '送信の拒否',
  by_setting: '設定で停止',
  internal: '処理の失敗',
}

type StatusTone = StatusBadgeTone
export const ACTION_STATUS: Record<EcActionExecutionStatus, { label: string; tone: StatusTone }> = {
  pending: { label: '処理中', tone: 'info' },
  processing: { label: '処理中', tone: 'info' },
  succeeded: { label: '処理完了', tone: 'success' },
  skipped: { label: '送信なし', tone: 'neutral' },
  retryable_failed: { label: '失敗', tone: 'danger' },
  permanent_failed: { label: '失敗', tone: 'danger' },
}
