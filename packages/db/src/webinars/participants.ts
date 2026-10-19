import { jstNow } from '../utils.js';
import { type WebinarParticipantQueryOptions, type WebinarParticipantOperation, type WebinarMonitoringSummary, type Webinar } from './types.js';
import { getWebinarById } from './definitions.js';


/**
 * 申込者∪入場者を friend 単位で返す。入場時刻が開催終了を過ぎた行は
 * 録画（replay）視聴としてライブと区別する。`options.classification` で
 * 未参加／途中離脱／完了／計測外に絞り込める。`measured = false`
 * （外部動画などで個人の視聴を取得できない）ときは分類不能を意味し、
 * 全員「計測外」になる——視聴データが無い人を未視聴と断定しない。
 */
export async function getWebinarParticipantOperations(
  db: D1Database,
  webinarId: string,
  limit = 100,
  offset = 0,
  options?: WebinarParticipantQueryOptions,
): Promise<WebinarParticipantOperation[]> {
  const durationSeconds = Math.max(0, options?.durationSeconds ?? 0);
  // 動画長が不明なら入場時刻だけでは録画と断定できない。境界を実質無限大にして
  // 全てライブ扱いにし、根拠のない録画判定を出さない。
  const replayBoundarySeconds = durationSeconds > 0 ? durationSeconds : 2_147_483_647;
  const measured = options?.measured ?? true;
  const classification = options?.classification ?? null;
  const threshold = Math.max(0, options?.completionThresholdSeconds ?? 0);

  const binds: unknown[] = [
    webinarId, webinarId,
    webinarId, webinarId, webinarId, webinarId, webinarId,
    webinarId,
    webinarId,
    webinarId, replayBoundarySeconds,
    webinarId, replayBoundarySeconds,
    replayBoundarySeconds, webinarId,
    webinarId, webinarId,
  ];
  let filterSql = '';
  if (classification === 'unmeasured') {
    // 計測可能なウェビナーに「計測外」の人はいない。
    if (measured) filterSql = 'WHERE 1 = 0';
  } else if (!measured) {
    // 計測不能のウェビナーでは未参加・離脱・完了を断定しない。
    if (classification) filterSql = 'WHERE 1 = 0';
  } else if (classification === 'unviewed') {
    filterSql = 'WHERE sessions = 0';
  } else if (classification === 'dropped_off') {
    filterSql = 'WHERE sessions > 0 AND max_watched_seconds < ?';
    binds.push(threshold);
  } else if (classification === 'completed') {
    filterSql = 'WHERE max_watched_seconds >= ?';
    binds.push(threshold);
  }
  binds.push(limit, offset);

  const result = await db.prepare(
    `WITH identities AS (
       SELECT friend_id FROM webinar_registrations WHERE webinar_id = ? AND status = 'active'
       UNION
       SELECT friend_id FROM webinar_viewers WHERE webinar_id = ?
     )
     SELECT * FROM (
       SELECT i.friend_id,
              f.display_name AS friend_name,
              f.picture_url,
              (SELECT COUNT(*) FROM webinar_viewers v WHERE v.webinar_id = ? AND v.friend_id = i.friend_id) AS sessions,
              COALESCE((SELECT MIN(v.joined_at) FROM webinar_viewers v WHERE v.webinar_id = ? AND v.friend_id = i.friend_id), '') AS first_joined_at,
              COALESCE((SELECT MAX(v.joined_at) FROM webinar_viewers v WHERE v.webinar_id = ? AND v.friend_id = i.friend_id), '') AS latest_joined_at,
              COALESCE((SELECT MAX(v.last_position_seconds) FROM webinar_viewers v WHERE v.webinar_id = ? AND v.friend_id = i.friend_id), 0) AS max_watched_seconds,
              (SELECT MAX(v.cta_clicked_at) FROM webinar_viewers v WHERE v.webinar_id = ? AND v.friend_id = i.friend_id) AS cta_clicked_at,
              EXISTS (
                SELECT 1 FROM webinar_registrations r
                WHERE r.webinar_id = ? AND r.friend_id = i.friend_id AND r.status = 'active'
              ) AS registered,
              (SELECT MAX(fs.created_at)
                 FROM form_submissions fs
                 JOIN webinar_ctas wc ON wc.form_id = fs.form_id
                WHERE wc.webinar_id = ? AND fs.friend_id = i.friend_id) AS form_submitted_at,
              (SELECT COUNT(*) FROM webinar_viewers v
                WHERE v.webinar_id = ? AND v.friend_id = i.friend_id
                  AND unixepoch(v.joined_at) < v.session_start_at + ?) AS live_sessions,
              (SELECT COUNT(*) FROM webinar_viewers v
                WHERE v.webinar_id = ? AND v.friend_id = i.friend_id
                  AND unixepoch(v.joined_at) >= v.session_start_at + ?) AS replay_sessions,
              (SELECT CASE WHEN unixepoch(v.joined_at) >= v.session_start_at + ?
                        THEN 'replay' ELSE 'live' END
                 FROM webinar_viewers v
                WHERE v.webinar_id = ? AND v.friend_id = i.friend_id
                ORDER BY v.joined_at DESC LIMIT 1) AS last_join_kind,
              (SELECT ae.status FROM webinar_action_executions ae
                WHERE ae.webinar_id = ? AND ae.friend_id = i.friend_id
                ORDER BY ae.updated_at DESC LIMIT 1) AS action_status,
              (SELECT ae.last_error FROM webinar_action_executions ae
                WHERE ae.webinar_id = ? AND ae.friend_id = i.friend_id
                ORDER BY ae.updated_at DESC LIMIT 1) AS action_error
         FROM identities i
         LEFT JOIN friends f ON f.id = i.friend_id
     )
     ${filterSql}
     ORDER BY latest_joined_at DESC, friend_id
     LIMIT ? OFFSET ?`,
  ).bind(...binds).all<Omit<WebinarParticipantOperation, 'integration_status'>>();
  return (result.results ?? []).map((row) => ({
    ...row,
    integration_status: row.action_status === 'succeeded'
      ? 'completed'
      : row.action_status === 'permanent_failed'
        ? 'needs_attention'
        : 'pending',
  }));
}

export async function getWebinarMonitoringSummary(
  db: D1Database,
  webinarId: string,
): Promise<WebinarMonitoringSummary> {
  const row = await db.prepare(
    `SELECT
       (SELECT COUNT(*) FROM webinar_notification_jobs
         WHERE webinar_id = ? AND status = 'permanent_failed') AS notification_failures,
       (SELECT COUNT(*) FROM (
          SELECT friend_id, session_start_at
            FROM webinar_registrations
           WHERE webinar_id = ? AND status = 'active'
           GROUP BY friend_id, session_start_at HAVING COUNT(*) > 1
        )) AS duplicate_registrations,
       0 AS view_segment_failures,
       (SELECT COUNT(*) FROM webinar_action_executions
         WHERE webinar_id = ? AND status = 'permanent_failed') AS action_failures`,
  ).bind(webinarId, webinarId, webinarId).first<WebinarMonitoringSummary>();
  return row ?? {
    notification_failures: 0,
    duplicate_registrations: 0,
    view_segment_failures: 0,
    action_failures: 0,
  };
}

export async function getWebinarPublicAccount(
  db: D1Database,
  accountId: string | null,
): Promise<{ id: string; name: string; liff_id: string | null } | null> {
  if (!accountId) return null;
  return db.prepare('SELECT id, name, liff_id FROM line_accounts WHERE id = ? AND archived_at IS NULL')
    .bind(accountId)
    .first<{ id: string; name: string; liff_id: string | null }>();
}

/**
 * ウェビナーを一覧から外す。申込・視聴・CTA・分析の記録は消さない。
 *
 * では物理削除を禁止しているため、従来のDELETE経路もこの更新へ寄せる。
 */
export async function archiveWebinar(db: D1Database, id: string): Promise<Webinar | null> {
  const existing = await getWebinarById(db, id);
  if (!existing) return null;
  await db
    .prepare("UPDATE webinars SET status = 'archived', updated_at = ? WHERE id = ?")
    .bind(jstNow(), id)
    .run();
  return getWebinarById(db, id);
}
