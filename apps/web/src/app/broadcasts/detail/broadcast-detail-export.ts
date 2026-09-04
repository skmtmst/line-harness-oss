type BroadcastDetailExport = {
  title: string
  status: string
  sentAt: string | null
  scheduledAt: string | null
  totalCount: number
  successCount: number
  delivered: number | null
  uniqueImpression: number | null
  uniqueClick: number | null
}

const STATUS_LABELS: Record<string, string> = {
  draft: '下書き', scheduled: '予約済み', sending: '送信中', sent: '送信済み',
}

function csvCell(value: string | number): string {
  const text = String(value)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

/** 画面に表示している実測値だけを、1配信1行のCSVへする。 */
export function broadcastDetailCsv(
  detail: BroadcastDetailExport,
  formatDateTime: (value: string | null | undefined) => string,
): string {
  const failed = detail.status === 'sent'
    ? Math.max(0, detail.totalCount - detail.successCount)
    : '—'
  const rows: Array<Array<string | number>> = [
    ['管理名', '状態', '送信日時', '対象件数', '送信成功', '送信失敗', 'LINE到達', '開封', 'クリック'],
    [
      detail.title,
      STATUS_LABELS[detail.status] ?? detail.status,
      formatDateTime(detail.sentAt ?? detail.scheduledAt),
      detail.totalCount,
      detail.successCount,
      failed,
      detail.delivered ?? '—',
      detail.uniqueImpression ?? '—',
      detail.uniqueClick ?? '—',
    ],
  ]
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`
}
