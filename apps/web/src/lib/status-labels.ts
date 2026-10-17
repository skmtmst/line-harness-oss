/** B-158：状態の言葉の正本。API の値と表示の言葉を分ける。 */
export const STATUS_LABELS = {
  draft: '下書き', scheduled: '予約中', sent: '送信済み',
  published: '公開中', active: '有効', stopped: '停止中', archived: 'アーカイブ',
} as const
export type StandardStatus = keyof typeof STATUS_LABELS
const ALIASES: Record<string, StandardStatus> = {
  稼働中: 'active', 動いている: 'active', 使用中: 'active', 使っている: 'active', オン: 'active',
  停止: 'stopped', 無効: 'stopped', 一時停止: 'stopped', 止めている: 'stopped', オフ: 'stopped',
  予約済み: 'scheduled', 送信待ち: 'scheduled', 配信待ち: 'scheduled',
  保管済み: 'archived', 保管済: 'archived', しまった: 'archived',
}
/** 審査・予約の受付・対応状況など、この表にない状態の意味は保つ。 */
export function statusLabel(status: string): string {
  return STATUS_LABELS[status as StandardStatus] ?? STATUS_LABELS[ALIASES[status]] ?? status
}

type StatusTone = 'neutral' | 'info' | 'warning' | 'success' | 'danger'

/** Google と Instagram の接続状態。同じ接続を設定と SNS で別の言葉にしない。 */
export const GOOGLE_CONNECTION_STATUS = {
  connected: { label: '接続済み', tone: 'success' },
  pending_location: { label: '未接続', tone: 'neutral' },
  expired: { label: '接続の異常', tone: 'danger' },
  no_permission: { label: '接続の異常', tone: 'danger' },
  disconnected: { label: '未接続', tone: 'neutral' },
} as const satisfies Record<string, { label: string; tone: StatusTone }>

export const INSTAGRAM_CONNECTION_STATUS = {
  connected: GOOGLE_CONNECTION_STATUS.connected,
  disconnected: GOOGLE_CONNECTION_STATUS.disconnected,
  expired: GOOGLE_CONNECTION_STATUS.expired,
  unconfigured: { label: '未設定', tone: 'neutral' },
} as const satisfies Record<string, { label: string; tone: StatusTone }>

/** Google ビジネスの投稿の状態（API の値 → 札の言葉と色）。画面では言葉を作らず、この表だけを読む。 */
export const GOOGLE_POST_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  draft: { label: '下書き', tone: 'neutral' },
  scheduled: { label: '予約中', tone: 'info' },
  pending_confirm: { label: '送信確認中', tone: 'warning' },
  accepted: { label: '審査中', tone: 'info' },
  published: { label: '公開済み', tone: 'success' },
  rejected: { label: 'Googleで不承認', tone: 'danger' },
  failed: { label: '送信失敗', tone: 'danger' },
  cancelled: { label: '取消済み', tone: 'neutral' },
  deleted: { label: '削除済み', tone: 'neutral' },
}

/** Google の口コミへの返信の状態（画面が決める分け方 → 札の言葉と色）。 */
export const GOOGLE_REPLY_STATUS = {
  published: { label: '返信済み', tone: 'success' },
  confirming: { label: '反映確認中', tone: 'warning' },
  draft: { label: '下書きあり', tone: 'info' },
  aiDraft: { label: 'AI下書きあり', tone: 'info' },
  attention: { label: '要確認', tone: 'danger' },
  unreplied: { label: '未返信', tone: 'warning' },
} as const satisfies Record<string, { label: string; tone: StatusTone }>
