/** B-158 で決めた、画面に出す状態の言葉。 */
export const STATUS_WORDS = {
  sending: ['下書き', '予約中', '送信済み'],
  publishable: ['公開中', '停止中'],
  automatic: ['有効', '停止中'],
  webinar: ['予定', '開催中', '終了'],
  archived: ['アーカイブ'],
} as const

/** 古い状態札の表記を、表示時に B-158 の言葉へ寄せる。本文の文言には適用しない。 */
const STATUS_WORD_ALIASES: Readonly<Record<string, string>> = {
  '稼働中': '有効',
  '一時停止': '停止中',
  '一時停止中': '停止中',
  '停止': '停止中',
  '送信待ち': '予約中',
  '配信待ち': '予約中',
  '配信予約中': '予約中',
  '送信予約中': '予約中',
  '予約済み': '予約中',
  '送信完了': '送信済み',
  'アーカイブ済み': 'アーカイブ',
  '保管': 'アーカイブ',
  '保管済み': 'アーカイブ',
}

export function normalizeStatusWord(label: string): string {
  return STATUS_WORD_ALIASES[label] ?? label
}
