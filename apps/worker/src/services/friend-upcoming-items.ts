import { buildSegmentWhere, parseCondition, type Broadcast } from '@line-crm/db';
import type { FriendUpcomingItem } from '@line-crm/shared';
import { computeDedupBroadcastPreview } from './dedup-broadcast.js';

/** 送信処理と同じ対象条件で、現在この友だちに予約されている配信を読む。 */
export async function getFriendUpcomingItems(
  db: D1Database, friendId: string, accountId: string | null, evaluatedAt: string,
): Promise<FriendUpcomingItem[]> {
  const scenarios = await db.prepare(`
    SELECT fs.id, fs.scenario_id, s.name, fs.next_delivery_at AS scheduledAt,
      CASE WHEN v.id IS NOT NULL THEN json_array_length(v.steps_snapshot)
        ELSE (SELECT COUNT(*) FROM scenario_steps WHERE scenario_id = s.id) END AS totalCount,
      (SELECT COUNT(DISTINCT COALESCE(ml.scenario_version_step_id, ml.scenario_step_id))
       FROM messages_log ml LEFT JOIN scenario_steps ss ON ss.id = ml.scenario_step_id
       WHERE ml.friend_id = fs.friend_id AND ml.direction = 'outgoing'
         AND julianday(ml.created_at) >= julianday(fs.started_at)
         AND ((v.id IS NOT NULL AND ml.scenario_version_step_id IN
           (SELECT json_extract(value, '$.version_step_id') FROM json_each(v.steps_snapshot)))
           OR (v.id IS NULL AND ss.scenario_id = s.id))) AS sentCount
    FROM friend_scenarios fs JOIN scenarios s ON s.id = fs.scenario_id
    LEFT JOIN scenario_versions v ON v.id = fs.published_version_id
    WHERE fs.friend_id = ? AND fs.status IN ('active', 'delivering')
      AND (s.line_account_id = ? OR s.line_account_id IS NULL)
    ORDER BY julianday(fs.next_delivery_at) IS NULL, julianday(fs.next_delivery_at), fs.id LIMIT 20
  `).bind(friendId, accountId).all<{
    id: string; scenario_id: string; name: string; scheduledAt: string | null; sentCount: number; totalCount: number;
  }>();
  const reminders = await db.prepare(`
    SELECT fr.id, fr.reminder_id, r.name,
      (SELECT MIN(rr.scheduled_at) FROM reminder_delivery_runs rr
       WHERE rr.friend_reminder_id = fr.id AND rr.status IN ('queued', 'claimed', 'retry_wait')) AS scheduledAt,
      (SELECT COUNT(*) FROM friend_reminder_deliveries WHERE friend_reminder_id = fr.id) AS sentCount,
      CASE WHEN fr.reminder_version_id IS NOT NULL THEN
        (SELECT COUNT(*) FROM reminder_version_steps WHERE reminder_version_id = fr.reminder_version_id)
        ELSE (SELECT COUNT(*) FROM reminder_steps WHERE reminder_id = r.id) END AS totalCount
    FROM friend_reminders fr JOIN reminders r ON r.id = fr.reminder_id
    WHERE fr.friend_id = ? AND fr.status = 'active'
      AND (r.line_account_id = ? OR r.line_account_id IS NULL)
    ORDER BY scheduledAt IS NULL, julianday(scheduledAt), fr.id LIMIT 20
  `).bind(friendId, accountId).all<{
    id: string; reminder_id: string; name: string; scheduledAt: string | null; sentCount: number; totalCount: number;
  }>();
  const runs = await db.prepare(`
    SELECT ar.id, ad.name, ar.resume_at AS scheduledAt
    FROM automation_runs ar JOIN automation_definitions ad ON ad.id = ar.automation_id
    WHERE ar.friend_id = ? AND ar.line_account_id = ? AND ad.line_account_id = ?
      AND ar.is_test = 0 AND ar.status IN ('queued', 'running', 'waiting')
    ORDER BY ar.resume_at IS NULL, julianday(ar.resume_at), ar.id LIMIT 20
  `).bind(friendId, accountId, accountId).all<{ id: string; name: string; scheduledAt: string | null }>();
  const items: FriendUpcomingItem[] = [
    ...scenarios.results.map(row => ({ ...row, kind: 'scenario' as const,
      href: `/scenarios/detail?id=${encodeURIComponent(row.scenario_id)}` })),
    ...reminders.results.map(row => ({ ...row, kind: 'reminder' as const,
      href: `/reminders/detail?id=${encodeURIComponent(row.reminder_id)}` })),
    ...runs.results.map(row => ({ ...row, kind: 'automation' as const, sentCount: null, totalCount: null,
      href: `/automations/runs?run=${encodeURIComponent(row.id)}` })),
  ];
  if (accountId) {
    let offset = 0;
    let matched = 0;
    while (matched < 20) {
      const page = await db.prepare(`SELECT b.* FROM broadcasts b
        WHERE b.status = 'scheduled' AND b.stopped_at IS NULL
          AND b.scheduled_at IS NOT NULL AND (b.line_account_id = ? OR
            (b.target_type = 'multi-account-dedup' AND EXISTS
              (SELECT 1 FROM json_each(b.account_ids) WHERE value = ?)))
        ORDER BY julianday(b.scheduled_at), b.id LIMIT 100 OFFSET ?`)
        .bind(accountId, accountId, offset).all<Broadcast>();
      for (const b of page.results) {
        let included = false;
        if (b.target_type === 'multi-account-dedup') {
          const preview = await computeDedupBroadcastPreview(db, JSON.parse(b.account_ids ?? '[]'),
            JSON.parse(b.dedup_priority ?? '[]'), b.target_tag_id);
          included = preview.perAccount.some(a => a.accountId === accountId &&
            a.recipients.some(f => f.friendId === friendId));
        } else {
          let clause = '';
          let values: unknown[] = [];
          if (b.target_type === 'tag') {
            clause = 'AND EXISTS (SELECT 1 FROM friend_tags ft WHERE ft.friend_id = f.id AND ft.tag_id = ?)';
            values = [b.target_tag_id];
          } else if (b.target_type === 'segment') {
            const condition = parseCondition(b.segment_conditions);
            if (!condition) throw new Error('予約配信の対象条件を読めません');
            const where = buildSegmentWhere(condition);
            clause = `AND (${where.sql})`;
            values = where.bindings;
          }
          included = Boolean(await db.prepare(`SELECT f.id FROM friends f
            WHERE f.id = ? AND f.line_account_id = ? AND f.is_following = 1 ${clause}`)
            .bind(friendId, accountId, ...values).first());
        }
        if (included) {
          items.push({ kind: 'broadcast', id: b.id, name: b.title, scheduledAt: b.scheduled_at,
            sentCount: 0, totalCount: 1, href: `/broadcasts/detail?id=${encodeURIComponent(b.id)}`,
            audienceEvaluatedAt: evaluatedAt });
          if (++matched === 20) break;
        }
      }
      if (page.results.length < 100) break;
      offset += 100;
    }
  }
  return items.sort((a, b) =>
    (a.scheduledAt ? new Date(a.scheduledAt).getTime() : Infinity) -
    (b.scheduledAt ? new Date(b.scheduledAt).getTime() : Infinity) || a.id.localeCompare(b.id)).slice(0, 20);
}
