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
