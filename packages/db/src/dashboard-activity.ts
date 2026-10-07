import type { D1Database } from '@cloudflare/workers-types';
import type { DashboardActivityItem } from '@line-crm/shared';

/** 通知センターとは別に、実際の記録から最近起きたことをまとめる。 */
export async function getDashboardActivity(
  db: D1Database, lineAccountId: string, limit: number,
): Promise<DashboardActivityItem[]> {
  const rows = await db.prepare(`WITH activity AS (
    SELECT 'broadcast:' || b.id AS id, 'broadcast_sent' AS kind,
      '配信「' || b.title || '」を送りました' AS summary, b.sent_at AS occurredAt,
      '/broadcasts/detail?id=' AS path, b.id AS targetId
    FROM broadcasts b WHERE b.status = 'sent' AND b.sent_at IS NOT NULL
      AND (b.line_account_id = ? OR (b.target_type = 'multi-account-dedup'
        AND EXISTS (SELECT 1 FROM json_each(b.account_ids) WHERE value = ?)))
    UNION ALL
    SELECT 'booking:' || b.id, 'booking_created', '予約が入りました', b.requested_at,
      '/booking/bookings/detail?id=', b.id FROM bookings b WHERE b.line_account_id = ?
    UNION ALL
    SELECT 'event:' || b.id, 'event_booking_created', 'イベントの予約が入りました', b.requested_at,
      '/events/detail?id=', b.event_id FROM event_bookings b WHERE b.line_account_id = ?
    UNION ALL
    SELECT 'form:' || fs.id, 'form_submitted', 'フォーム「' || f.name || '」に回答がありました',
      fs.created_at, '/form-submissions/responses?id=', f.id
    FROM form_submissions fs JOIN forms f ON f.id = fs.form_id
    LEFT JOIN friends fr ON fr.id = fs.friend_id
    WHERE fs.is_test = 0 AND COALESCE(
      (SELECT c.line_account_id FROM form_submit_claims c WHERE c.submission_id = fs.id LIMIT 1),
      fr.line_account_id,
      (SELECT MIN(fa.line_account_id) FROM form_accounts fa WHERE fa.form_id = fs.form_id HAVING COUNT(*) = 1)
    ) = ? AND EXISTS (SELECT 1 FROM form_accounts fa WHERE fa.form_id = f.id AND fa.line_account_id = ?)
    UNION ALL
    SELECT 'friend:' || e.id, 'friend_added',
      CASE e.friend_kind WHEN 'returning' THEN '友だちが再登録しました' ELSE '友だちが増えました' END,
      e.occurred_at, '/friends/detail?id=', e.friend_id
    FROM friend_add_events e JOIN friends f ON f.id = e.friend_id
    WHERE e.line_account_id = ? AND f.line_account_id = ?
  ) SELECT * FROM activity ORDER BY julianday(occurredAt) DESC, id DESC LIMIT ?`)
    .bind(lineAccountId, lineAccountId, lineAccountId, lineAccountId,
      lineAccountId, lineAccountId, lineAccountId, lineAccountId, limit)
    .all<{ id: string; kind: DashboardActivityItem['kind']; summary: string; occurredAt: string; path: string; targetId: string }>();
  return rows.results.map(({ path, targetId, ...row }) => ({ ...row, href: path + encodeURIComponent(targetId) }));
}
