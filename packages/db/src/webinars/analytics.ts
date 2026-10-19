import { type WebinarParticipantStat, type WebinarAnalyticsSummaryRow, type WebinarDailyStat } from './types.js';


/** 参加者を friend 単位にまとめる。再入場・複数セッションは1人として表示する。 */
export async function getWebinarParticipantStats(
  db: D1Database,
  webinarId: string,
  limit = 200,
): Promise<WebinarParticipantStat[]> {
  const { results } = await db
    .prepare(
      `SELECT v.friend_id,
              f.display_name AS friend_name,
              f.picture_url,
              COUNT(*) AS sessions,
              MIN(v.joined_at) AS first_joined_at,
              MAX(v.joined_at) AS latest_joined_at,
              MAX(v.last_position_seconds) AS max_watched_seconds,
              MAX(v.cta_clicked_at) AS cta_clicked_at,
              CASE WHEN EXISTS (
                SELECT 1 FROM webinar_registrations r
                WHERE r.webinar_id = v.webinar_id AND r.friend_id = v.friend_id
              ) THEN 1 ELSE 0 END AS registered,
              (
                SELECT MAX(fs.created_at)
                FROM form_submissions fs
                JOIN webinar_ctas wc ON wc.form_id = fs.form_id
                JOIN webinars wf ON wf.id = wc.webinar_id
                WHERE wc.webinar_id = v.webinar_id
                  AND fs.friend_id = v.friend_id
                  AND fs.created_at >= wf.created_at
              ) AS form_submitted_at
       FROM webinar_viewers v
       LEFT JOIN friends f ON f.id = v.friend_id
       WHERE v.webinar_id = ?
       GROUP BY v.webinar_id, v.friend_id, f.display_name, f.picture_url
       ORDER BY latest_joined_at DESC
       LIMIT ?`,
    )
    .bind(webinarId, limit)
    .all<WebinarParticipantStat>();
  return results ?? [];
}

/** KPI は全参加者で集計し、顔写真付き一覧の表示件数に左右されないようにする。 */
export async function getWebinarAnalyticsSummary(
  db: D1Database,
  webinarId: string,
  completionThresholdSeconds: number,
): Promise<WebinarAnalyticsSummaryRow> {
  const row = await db
    .prepare(
      `WITH viewer_rollup AS (
         SELECT friend_id,
                MAX(last_position_seconds) AS max_watched_seconds,
                MAX(CASE WHEN cta_clicked_at IS NOT NULL THEN 1 ELSE 0 END) AS clicked
         FROM webinar_viewers WHERE webinar_id = ? GROUP BY friend_id
       ), form_submitters AS (
         SELECT DISTINCT fs.friend_id
         FROM form_submissions fs
         JOIN webinar_ctas wc ON wc.form_id = fs.form_id
         JOIN webinars w ON w.id = wc.webinar_id
         WHERE wc.webinar_id = ? AND fs.created_at >= w.created_at
       )
       SELECT
         (SELECT COUNT(DISTINCT friend_id) FROM webinar_registrations
          WHERE webinar_id = ?) AS reservations,
         COUNT(*) AS viewers,
         COALESCE(SUM(CASE WHEN EXISTS (
           SELECT 1 FROM webinar_registrations r
           WHERE r.webinar_id = ? AND r.friend_id = vr.friend_id
         ) THEN 1 ELSE 0 END), 0) AS registered_and_joined,
         COALESCE(SUM(CASE WHEN vr.max_watched_seconds >= 300 THEN 1 ELSE 0 END), 0) AS watched_5m,
         COALESCE(SUM(CASE WHEN vr.max_watched_seconds >= 900 THEN 1 ELSE 0 END), 0) AS watched_15m,
         COALESCE(SUM(CASE WHEN vr.max_watched_seconds >= ? THEN 1 ELSE 0 END), 0) AS completed,
         COALESCE(CAST(AVG(vr.max_watched_seconds) AS INTEGER), 0) AS avg_watched_seconds,
         COALESCE(SUM(vr.clicked), 0) AS cta_clicks,
         COALESCE(SUM(CASE WHEN fs.friend_id IS NOT NULL THEN 1 ELSE 0 END), 0) AS form_submissions
       FROM viewer_rollup vr
       LEFT JOIN form_submitters fs ON fs.friend_id = vr.friend_id`,
    )
    .bind(
      webinarId,
      webinarId,
      webinarId,
      webinarId,
      completionThresholdSeconds,
    )
    .first<WebinarAnalyticsSummaryRow>();
  return row ?? {
    reservations: 0,
    viewers: 0,
    registered_and_joined: 0,
    watched_5m: 0,
    watched_15m: 0,
    completed: 0,
    avg_watched_seconds: 0,
    cta_clicks: 0,
    form_submissions: 0,
  };
}

/** 日別の予約→参加→CTA→フォーム推移。日本時間の保存文字列を日付で集計する。 */
export async function getWebinarDailyStats(
  db: D1Database,
  webinarId: string,
): Promise<WebinarDailyStat[]> {
  const { results } = await db
    .prepare(
      `WITH regs AS (
         SELECT friend_id, created_at FROM webinar_registrations WHERE webinar_id = ?
       ), views AS (
         SELECT friend_id, joined_at, cta_clicked_at FROM webinar_viewers WHERE webinar_id = ?
       ), submissions AS (
         SELECT fs.friend_id, fs.created_at
         FROM form_submissions fs
         JOIN webinar_ctas wc ON wc.form_id = fs.form_id
         JOIN webinars w ON w.id = wc.webinar_id
         WHERE wc.webinar_id = ? AND fs.created_at >= w.created_at
       ), dates AS (
         SELECT substr(created_at, 1, 10) AS stat_date FROM regs
         UNION SELECT substr(joined_at, 1, 10) FROM views
         UNION SELECT substr(cta_clicked_at, 1, 10) FROM views WHERE cta_clicked_at IS NOT NULL
         UNION SELECT substr(created_at, 1, 10) FROM submissions
       )
       SELECT d.stat_date,
              (SELECT COUNT(DISTINCT friend_id) FROM regs
               WHERE substr(created_at, 1, 10) = d.stat_date) AS reservations,
              (SELECT COUNT(DISTINCT friend_id) FROM views
               WHERE substr(joined_at, 1, 10) = d.stat_date) AS viewers,
              (SELECT COUNT(DISTINCT friend_id) FROM views
               WHERE substr(cta_clicked_at, 1, 10) = d.stat_date) AS cta_clicks,
              (SELECT COUNT(DISTINCT friend_id) FROM submissions
               WHERE substr(created_at, 1, 10) = d.stat_date) AS form_submissions
       FROM dates d
       WHERE d.stat_date IS NOT NULL AND d.stat_date <> ''
       ORDER BY d.stat_date ASC`,
    )
    .bind(webinarId, webinarId, webinarId)
    .all<WebinarDailyStat>();
  return results ?? [];
}
