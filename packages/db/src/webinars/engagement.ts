import { jstNow } from '../utils.js';
import { type WebinarComment, type WebinarFunnelEventType, type WebinarFormFunnelStats, type WebinarUserComment, type WebinarSessionStat } from './types.js';
import { WEBINAR_RETENTION_BUCKET_SECONDS } from './playback.js';


export async function getWebinarComments(
  db: D1Database,
  webinarId: string,
): Promise<WebinarComment[]> {
  const { results } = await db
    .prepare('SELECT * FROM webinar_comments WHERE webinar_id = ? ORDER BY at_seconds ASC')
    .bind(webinarId)
    .all<WebinarComment>();
  return results ?? [];
}

export async function replaceWebinarComments(
  db: D1Database,
  webinarId: string,
  comments: Array<{ atSeconds: number; authorName: string; body: string }>,
): Promise<number> {
  const now = jstNow();
  const stmts = [
    db.prepare('DELETE FROM webinar_comments WHERE webinar_id = ?').bind(webinarId),
    ...comments.map((cm) =>
      db
        .prepare(
          `INSERT INTO webinar_comments (id, webinar_id, at_seconds, author_name, body, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(crypto.randomUUID(), webinarId, cm.atSeconds, cm.authorName, cm.body, now),
    ),
  ];
  await db.batch(stmts);
  return comments.length;
}

export async function upsertWebinarViewer(
  db: D1Database,
  webinarId: string,
  friendId: string,
  sessionStartAt: number,
): Promise<{ firstJoin: boolean }> {
  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO webinar_viewers
         (id, webinar_id, friend_id, session_start_at, joined_at, last_position_seconds)
       VALUES (?, ?, ?, ?, ?, 0)`,
    )
    .bind(crypto.randomUUID(), webinarId, friendId, sessionStartAt, jstNow())
    .run();
  return { firstJoin: (result.meta?.changes ?? 0) > 0 };
}

export async function updateWebinarViewerPosition(
  db: D1Database,
  webinarId: string,
  friendId: string,
  sessionStartAt: number,
  positionSeconds: number,
): Promise<void> {
  await db
    .prepare(
      `UPDATE webinar_viewers
       SET last_position_seconds = MAX(last_position_seconds, ?)
       WHERE webinar_id = ? AND friend_id = ? AND session_start_at = ?`,
    )
    .bind(positionSeconds, webinarId, friendId, sessionStartAt)
    .run();
}

export async function recordWebinarCtaClick(
  db: D1Database,
  webinarId: string,
  friendId: string,
  sessionStartAt: number,
): Promise<void> {
  await db
    .prepare(
      `UPDATE webinar_viewers
       SET cta_clicked_at = COALESCE(cta_clicked_at, ?)
       WHERE webinar_id = ? AND friend_id = ? AND session_start_at = ?`,
    )
    .bind(jstNow(), webinarId, friendId, sessionStartAt)
    .run();
}

/**
 * CTA→フォームの途中離脱を friend 単位で計測する。
 * INSERT OR IGNORE により再入場・連打・React の再描画でも重複計上しない。
 */
export async function recordWebinarFunnelEvent(
  db: D1Database,
  input: {
    webinarId: string;
    friendId: string;
    sessionStartAt: number;
    eventType: WebinarFunnelEventType;
    ctaId?: string | null;
    formId?: string | null;
    fieldName?: string | null;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO webinar_funnel_events
         (id, webinar_id, friend_id, session_start_at, event_type,
          cta_id, form_id, field_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      input.webinarId,
      input.friendId,
      input.sessionStartAt,
      input.eventType,
      input.ctaId ?? '',
      input.formId ?? '',
      input.fieldName ?? '',
      jstNow(),
    )
    .run();
}

export async function getWebinarFormFunnelStats(
  db: D1Database,
  webinarId: string,
): Promise<WebinarFormFunnelStats> {
  const [summary, fields] = await Promise.all([
    db
      .prepare(
        `WITH config AS (
           SELECT enabled_at FROM webinar_followup_configs WHERE webinar_id = ?
         ), first_cta AS (
           SELECT MIN(at_seconds) AS at_seconds FROM webinar_ctas WHERE webinar_id = ?
         ), tracked_forms AS (
           SELECT DISTINCT form_id FROM webinar_ctas
           WHERE webinar_id = ? AND form_id IS NOT NULL
         )
         SELECT
           (SELECT COUNT(DISTINCT v.friend_id)
            FROM webinar_viewers v, config, first_cta
            WHERE v.webinar_id = ?
              AND datetime(v.joined_at) >= datetime(config.enabled_at)
              AND v.last_position_seconds >= first_cta.at_seconds) AS cta_impressions,
           (SELECT COUNT(DISTINCT v.friend_id)
            FROM webinar_viewers v, config
            WHERE v.webinar_id = ? AND v.cta_clicked_at IS NOT NULL
              AND datetime(v.cta_clicked_at) >= datetime(config.enabled_at)) AS cta_clicks,
           (SELECT COUNT(DISTINCT fo.friend_id)
            FROM form_opens fo, config
            WHERE fo.form_id IN (SELECT form_id FROM tracked_forms)
              AND fo.friend_id IS NOT NULL
              AND datetime(fo.opened_at) >= datetime(config.enabled_at)) AS form_opens,
           (SELECT COUNT(DISTINCT e.friend_id) FROM webinar_funnel_events e
            WHERE e.webinar_id = ? AND e.event_type = 'form_start') AS form_starts,
           (SELECT COUNT(DISTINCT e.friend_id) FROM webinar_funnel_events e
            WHERE e.webinar_id = ? AND e.event_type = 'submit_attempt') AS submit_attempts,
           (SELECT COUNT(DISTINCT fs.friend_id)
            FROM form_submissions fs, config
            WHERE fs.form_id IN (SELECT form_id FROM tracked_forms)
              AND datetime(fs.created_at) >= datetime(config.enabled_at)) AS submit_successes,
           (SELECT COUNT(DISTINCT e.friend_id) FROM webinar_funnel_events e
            WHERE e.webinar_id = ? AND e.event_type = 'submit_error') AS submit_errors`,
      )
      .bind(
        webinarId, webinarId, webinarId, webinarId, webinarId,
        webinarId, webinarId, webinarId,
      )
      .first<Omit<WebinarFormFunnelStats, 'field_completions'>>(),
    db
      .prepare(
        `SELECT field_name, COUNT(DISTINCT friend_id) AS users
         FROM webinar_funnel_events
         WHERE webinar_id = ? AND event_type = 'field_complete' AND field_name <> ''
         GROUP BY field_name
         ORDER BY users DESC, field_name ASC`,
      )
      .bind(webinarId)
      .all<{ field_name: string; users: number }>(),
  ]);
  return {
    cta_impressions: summary?.cta_impressions ?? 0,
    cta_clicks: summary?.cta_clicks ?? 0,
    form_opens: summary?.form_opens ?? 0,
    form_starts: summary?.form_starts ?? 0,
    submit_attempts: summary?.submit_attempts ?? 0,
    submit_successes: summary?.submit_successes ?? 0,
    submit_errors: summary?.submit_errors ?? 0,
    field_completions: fields.results ?? [],
  };
}

export async function insertWebinarUserComment(
  db: D1Database,
  input: {
    webinarId: string;
    friendId: string;
    sessionStartAt: number;
    atSeconds: number;
    body: string;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO webinar_user_comments
         (id, webinar_id, friend_id, session_start_at, at_seconds, body, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(), input.webinarId, input.friendId, input.sessionStartAt,
      input.atSeconds, input.body, jstNow(),
    )
    .run();
}

export async function countSessionUserComments(
  db: D1Database,
  webinarId: string,
  friendId: string,
  sessionStartAt: number,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM webinar_user_comments
       WHERE webinar_id = ? AND friend_id = ? AND session_start_at = ?`,
    )
    .bind(webinarId, friendId, sessionStartAt)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function getWebinarUserComments(
  db: D1Database,
  webinarId: string,
  limit = 200,
): Promise<WebinarUserComment[]> {
  const { results } = await db
    .prepare(
      `SELECT wuc.*, f.display_name AS friend_name
              , f.picture_url
       FROM webinar_user_comments wuc
       LEFT JOIN friends f ON f.id = wuc.friend_id
       WHERE wuc.webinar_id = ?
       ORDER BY wuc.created_at DESC, wuc.id DESC LIMIT ?`,
    )
    .bind(webinarId, limit)
    .all<WebinarUserComment>();
  return results ?? [];
}

export async function getWebinarSessionStats(
  db: D1Database,
  webinarId: string,
): Promise<WebinarSessionStat[]> {
  const { results } = await db
    .prepare(
      `SELECT session_start_at,
              COUNT(*) AS viewers,
              CAST(AVG(last_position_seconds) AS INTEGER) AS avg_watched_seconds,
              SUM(CASE WHEN cta_clicked_at IS NOT NULL THEN 1 ELSE 0 END) AS cta_clicks
       FROM webinar_viewers
       WHERE webinar_id = ?
       GROUP BY session_start_at
       ORDER BY session_start_at DESC`,
    )
    .bind(webinarId)
    .all<WebinarSessionStat>();
  return results ?? [];
}

/**
 * 離脱位置分布（J #821）。
 * 離脱の位置＝最後の有効な区間の終わり。最後に報告された位置
 * （last_position_seconds）では決めつけない。区間が無い人
 * （見ていない・異常だけの人）は数えない。
 */
export async function getWebinarDropoff(
  db: D1Database,
  webinarId: string,
  bucketSeconds = WEBINAR_RETENTION_BUCKET_SECONDS,
): Promise<Array<{ bucket_start: number; viewers: number }>> {
  const { results } = await db
    .prepare(
      `SELECT friend_id, MAX(end_seconds) AS last_end
         FROM webinar_view_segments
        WHERE webinar_id = ?
        GROUP BY friend_id`,
    )
    .bind(webinarId)
    .all<{ friend_id: string; last_end: number }>();
  const buckets = new Map<number, number>();
  for (const row of results ?? []) {
    const end = Math.max(1, Math.floor(row.last_end));
    const bucket = Math.floor((end - 1) / bucketSeconds) * bucketSeconds;
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([bucket_start, viewers]) => ({ bucket_start, viewers }));
}
