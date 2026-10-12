import type { FriendField, FriendFieldType } from '@line-crm/shared'

export const FIELD_TYPE_HINTS: Record<FriendFieldType, string> = {
  text: '短いテキスト', textarea: '長い文章', number: '体重など', date: '誕生日など', datetime: '予約日時など', time: '来店時刻など（HH:MM）',
  select: '決まった選択肢から選ぶ', multi_select: '決まった選択肢から複数選ぶ',
  checkbox: 'はい / いいえ', url: 'リンク', tel: '電話番号', email: 'メールアドレス', image: '画像ファイル', pdf: 'PDFファイル',
}

export const FIELD_TYPE_LABELS: Record<FriendFieldType, string> = {
  text: '1行テキスト', textarea: '複数行テキスト', number: '数値', date: '日付', datetime: '日時', time: '時刻',
  select: '単一選択', multi_select: '複数選択', checkbox: '真偽', url: 'URL',
  tel: '電話番号', email: 'メール', image: '画像', pdf: 'PDF',
}

export function destinationLabel(field: FriendField): string {
  if (field.displayTargets?.length) return field.displayTargets.join('・')
  const places = ['友だち詳細', 'テンプレート差し込み']
  if (field.isStarred) places.push('友だち一覧')
  if (field.ecIsMaster) places.push('EC連携')
  return places.join('・')
}

export function knownUsageCount(field: FriendField): number | null {
  return typeof field.usageCount === 'number' && Number.isFinite(field.usageCount) && field.usageCount >= 0
    ? field.usageCount
    : null
}

export function fieldDeletionBlockedReason(field: FriendField): string | null {
  const usageCount = knownUsageCount(field)
  if (usageCount === null) return '使用人数を確認できないため削除できません。再読み込みしてください。'
  if (usageCount > 0) return '値が入っているため、先に項目を移行してください'
  return null
}
