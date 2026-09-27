type SupportEmailInboxQuery = {
  status: string
  query?: string
  limit?: number
  /** 2ページ目以降の開始位置。「さらに読み込む」で遡るときに渡す。 */
  offset?: number
  assignee?: string
  unreadOnly?: boolean
  quickFilter?: 'reply' | 'overdue'
  /** 選択中のLINEアカウント。件数（quick-counts）と同じ条件にする。 */
  accountId?: string
}

/*
 * R110: 選択中のLINEアカウントは検索条件へ混ぜる。メールにアカウントの
 * 紐付けは無いが、件数側はアカウント選択中にメールを数えない。
 * 一覧だけ混ぜないと「一覧にあるのに件数が0」になる。
 * アカウント未選択のときは送らず、全メールのままにする。
 */
export function buildSupportEmailInboxQuery({
  status,
  query,
  limit = 200,
  offset = 0,
  assignee,
  unreadOnly,
  quickFilter,
  accountId,
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
    ...(accountId ? { lineAccountId: accountId } : {}),
  }).toString()
}
