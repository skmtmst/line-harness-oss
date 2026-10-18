/** Tenant-wide inbox states and observed mark changes are different measures. */
export async function markListStats(db: D1Database, tenantId: string, now = new Date()) {
  const until = now.toISOString();
  const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const inbox = await db.prepare(`SELECT
      COUNT(DISTINCT c.friend_id) AS inbox_friend_count,
      COUNT(DISTINCT CASE WHEN c.status='unread' THEN c.friend_id END) AS unhandled_friend_count,
      COUNT(DISTINCT CASE WHEN c.status='in_progress' THEN c.friend_id END) AS in_progress_friend_count
    FROM chats c
    JOIN friends f ON f.id=c.friend_id AND f.line_account_id=c.line_account_id
    JOIN line_accounts a ON a.id=f.line_account_id
    WHERE a.tenant_id=? AND a.is_active=1 AND a.archived_at IS NULL AND f.is_hidden=0`)
    .bind(tenantId).first<{ inbox_friend_count: number; unhandled_friend_count: number; in_progress_friend_count: number }>();
  const changes = await db.prepare(`SELECT COUNT(*) AS count FROM operation_audit o
    JOIN friends f ON f.id=o.friend_id
    JOIN line_accounts a ON a.id=f.line_account_id
    WHERE a.tenant_id=? AND a.is_active=1 AND a.archived_at IS NULL AND f.is_hidden=0
      AND o.target_kind='support_mark' AND o.action='changed'
      AND julianday(CASE WHEN substr(o.created_at,-1)='Z' OR substr(o.created_at,-6,1) IN ('+','-')
        THEN o.created_at ELSE o.created_at || '+09:00' END)>=julianday(?)
      AND julianday(CASE WHEN substr(o.created_at,-1)='Z' OR substr(o.created_at,-6,1) IN ('+','-')
        THEN o.created_at ELSE o.created_at || '+09:00' END)<julianday(?)`)
    .bind(tenantId, since, until).first<{ count: number }>();
  if (!inbox || !changes) throw new Error('MARK_STATS_UNAVAILABLE');
  return {
    inbox: {
      source: 'chats' as const,
      friendCount: inbox.inbox_friend_count,
      unhandledFriendCount: inbox.unhandled_friend_count,
      inProgressFriendCount: inbox.in_progress_friend_count,
      unhandledPercent: inbox.inbox_friend_count ? 100 * inbox.unhandled_friend_count / inbox.inbox_friend_count : null,
    },
    markChanges: {
      source: 'operation_audit' as const,
      count: changes.count,
      coverage: 'recorded_events_only' as const,
      since, until,
    },
    scope: 'active_accounts_visible_friends' as const,
    updatedAt: until,
  };
}
