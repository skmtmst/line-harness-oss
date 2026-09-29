type SupportEmailInboxQuery = {
  status: string
  query?: string
  limit?: number
  /** 2ページ目以降の開始位置。「さらに読み込む」で遡るときに渡す。 */
  offset?: number
  assignee?: string
  unreadOnly?: boolean
  quickFilter?: 'reply' | 'overdue'
}

/**
 * メール問い合わせはLINEアカウントに所属していないため、
 * 選択中のLINEアカウントを検索条件へ混ぜない。
 */
export function buildSupportEmailInboxQuery({
  status,
  query,
  limit = 200,
  offset = 0,
  assignee,
  unreadOnly,
  quickFilter,
}: SupportEmailInboxQuery): string {
  return new URLSearchParams({
    channel: 'email',
    status,
    limit: String(limit),
    ...(offset > 0 ? { offset: String(offset) } : {}),
    ...(query ? { q: query } : {}),
    ...(assignee && assignee !== 'all' ? { assignee } : {}),
    ...(unreadOnly ? { unreadOnly: '1' } : {}),
    ...(quickFilter ? { quickFilter } : {}),
  }).toString()
}
