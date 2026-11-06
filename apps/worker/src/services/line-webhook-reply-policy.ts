/** 事前に返信不要と証明できるのはルールなしだけなので、真偽値で保持し、本文や replyToken を複製しない。 */
export async function snapshotLineReplyPolicy(db: D1Database, accountId: string | null, messageKind: string): Promise<{ configured: boolean }> {
  const rule = await db.prepare(`SELECT 1 FROM auto_replies WHERE is_active=1 AND deleted_at IS NULL
    AND (line_account_id IS NULL OR line_account_id=?) LIMIT 1`).bind(accountId).first();
  const fallback = messageKind === 'text' && accountId
    ? await db.prepare('SELECT 1 FROM auto_reply_unmatched_settings WHERE line_account_id=? AND message IS NOT NULL AND length(message)>0')
      .bind(accountId).first() : null;
  return { configured: Boolean(rule || fallback) };
}
