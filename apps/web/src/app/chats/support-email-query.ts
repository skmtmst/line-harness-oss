type SupportEmailInboxQuery = {
  status: string
  query?: string
  limit?: number
}

/**
 * メール問い合わせはLINEアカウントに所属していないため、
 * 選択中のLINEアカウントを検索条件へ混ぜない。
 */
export function buildSupportEmailInboxQuery({
  status,
  query,
  limit = 200,
}: SupportEmailInboxQuery): string {
  return new URLSearchParams({
    channel: 'email',
    status,
    limit: String(limit),
    ...(query ? { q: query } : {}),
  }).toString()
}
