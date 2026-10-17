/** B-158：状態の言葉の正本。API の値と表示の言葉を分ける。 */
export const STATUS_LABELS = {
  draft: '下書き', scheduled: '予約中', sent: '送信済み',
  published: '公開中', active: '有効', stopped: '停止中', archived: 'アーカイブ',
} as const
export type StandardStatus = keyof typeof STATUS_LABELS
const ALIASES: Record<string, StandardStatus> = {
  稼働中: 'active', 動いている: 'active', オン: 'active',
  停止: 'stopped', 無効: 'stopped', 一時停止: 'stopped', 一時停止中: 'stopped', 止めている: 'stopped', オフ: 'stopped',
  予約済み: 'scheduled', 送信待ち: 'scheduled', 配信待ち: 'scheduled', 配信予約中: 'scheduled', 送信予約中: 'scheduled',
  送信完了: 'sent',
  保管: 'archived', 保管済み: 'archived', 保管済: 'archived', しまった: 'archived', アーカイブ済み: 'archived',
}
/** 審査・予約の受付・対応状況や「使用中」という用途は、別の状態に読み替えない。 */
export function statusLabel(status: string): string {
  if (Object.hasOwn(STATUS_LABELS, status)) return STATUS_LABELS[status as StandardStatus]
  return Object.hasOwn(ALIASES, status) ? STATUS_LABELS[ALIASES[status]] : status
}

/** 用途ごとの状態語。同じ状態の表示は STATUS_LABELS から読む。 */
export const STATUS_WORDS = {
  sending: [STATUS_LABELS.draft, STATUS_LABELS.scheduled, STATUS_LABELS.sent],
  publishable: [STATUS_LABELS.published, STATUS_LABELS.stopped],
  automatic: [STATUS_LABELS.active, STATUS_LABELS.stopped],
  webinar: ['予定', '開催中', '終了'],
  archived: [STATUS_LABELS.archived],
} as const

/** 旧部品の公開名は維持し、言い換えの表は一つだけにする。本文には適用しない。 */
export { statusLabel as normalizeStatusWord }
