import { accountFeatureOffExclusionSql, isAccountFeatureEnabled } from '../account-settings.js';
import { jstNow } from '../utils.js';
import { type MileageQueueResult, type EngagementEvent, type FollowingMileageReconcileResult } from './types.js';
import { applyMileageRulesImmediately } from './grants.js';
import { parsePublishedSnapshot } from './rules.js';


/**
 * 付与キューの行の持ち主(=イベントの友だちが属するアカウント)が
 * マイル機能オフかをSQL内で判定する式。持ち主不明の旧行は偽になり、
 * 従来どおり進む。
 */
export function mileageOwnerOffSql(eventIdColumn: string): string {
  return `EXISTS (
    SELECT 1 FROM engagement_events ee
      JOIN friends f ON f.id = ee.actor_friend_id
     WHERE ee.id = ${eventIdColumn}
       AND ${accountFeatureOffExclusionSql('f.line_account_id', 'mileage')}
  )`;
}

/** Drain a bounded batch. Safe for retries and overlapping cron invocations. */
export async function processPendingMileageEvents(
  db: D1Database,
  options: { limit?: number; now?: string } = {},
): Promise<MileageQueueResult> {
  const limit = Math.min(250, Math.max(1, options.limit ?? 100));
  const now = options.now ?? jstNow();
  // 停滞回収も機能オフ中のアカウントには当てない。OFF中は status も
  // processing_started_at も updated_at も動かさず、再オンで回収する。
  await db
    .prepare(
      `UPDATE mileage_event_queue
          SET status = 'pending', processing_started_at = NULL, updated_at = ?
        WHERE status = 'processing'
          AND datetime(processing_started_at) < datetime(?, '-10 minutes')
          AND NOT ${mileageOwnerOffSql('mileage_event_queue.engagement_event_id')}`,
    )
    .bind(now, now)
    .run();

  // 機能オフ中の行は LIMIT を数える前に外す。後で弾くと、オフの古い行が
  // 先頭を占めたままON中の他アカウントが永久に回らない。
  const due = await db
    .prepare(
      `SELECT q.engagement_event_id, q.applied_published_snapshot
         FROM mileage_event_queue q
        WHERE q.status IN ('pending','failed')
          AND q.attempts < 5
          AND datetime(q.available_at) <= datetime(?)
          AND NOT ${mileageOwnerOffSql('q.engagement_event_id')}
        ORDER BY q.created_at ASC, q.engagement_event_id ASC
        LIMIT ?`,
    )
    .bind(now, limit)
    .all<{ engagement_event_id: string; applied_published_snapshot: string | null }>();

  const result: MileageQueueResult = { claimed: 0, processed: 0, failed: 0, granted: 0 };
  for (const item of due.results) {
    // 機能オフ中はclaim(状態更新)も付与もしない。pendingのまま残し、
    // 再オンで再開する。持ち主が分からない行は従来どおり進める。
    const owner = await db
      .prepare(
        `SELECT f.line_account_id AS line_account_id
           FROM engagement_events ee LEFT JOIN friends f ON f.id = ee.actor_friend_id
          WHERE ee.id = ?`,
      )
      .bind(item.engagement_event_id)
      .first<{ line_account_id: string | null }>();
    if (owner?.line_account_id
      && !await isAccountFeatureEnabled(db, owner.line_account_id, 'mileage')) {
      continue;
    }
    const claim = await db
      .prepare(
        `UPDATE mileage_event_queue
            SET status = 'processing', attempts = attempts + 1,
                processing_started_at = ?, updated_at = ?, last_error = NULL
          WHERE engagement_event_id = ? AND status IN ('pending','failed')`,
      )
      .bind(now, now, item.engagement_event_id)
      .run();
    if ((claim.meta?.changes ?? 0) === 0) continue;
    result.claimed += 1;

    try {
      const event = await db
        .prepare(`SELECT * FROM engagement_events WHERE id = ?`)
        .bind(item.engagement_event_id)
        .first<EngagementEvent>();
      if (!event?.actor_friend_id || !event.source_event_id) {
        throw new Error('Queued mileage event has no friend or source event');
      }
      let metadata: Record<string, unknown> = {};
      if (event.metadata) {
        try { metadata = JSON.parse(event.metadata) as Record<string, unknown>; } catch { metadata = {}; }
      }
      const projection = await applyMileageRulesImmediately(db, {
        eventType: event.event_type,
        source: event.source,
        sourceEventId: event.source_event_id,
        friendId: event.actor_friend_id,
        subjectKey: typeof metadata.subjectKey === 'string' ? metadata.subjectKey : null,
        metadata,
        occurredAt: event.occurred_at,
        // N-231 案1: 現在版ではなく受付時に固定した版を読む。NULL は旧来互換。
        publishedSnapshot: parsePublishedSnapshot(item.applied_published_snapshot),
      });
      result.granted += projection.granted.length;
      result.processed += 1;
      await db
        .prepare(
          `UPDATE mileage_event_queue
              SET status = 'processed', processed_at = ?, processing_started_at = NULL,
                  updated_at = ?, last_error = NULL
            WHERE engagement_event_id = ?`,
        )
        .bind(now, now, event.id)
        .run();
    } catch (error) {
      result.failed += 1;
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
      await db
        .prepare(
          `UPDATE mileage_event_queue
              SET status = 'failed', processing_started_at = NULL,
                  available_at = datetime(?, '+' || MIN(attempts * 5, 60) || ' minutes'),
                  updated_at = ?, last_error = ?
            WHERE engagement_event_id = ?`,
        )
        .bind(now, now, message, item.engagement_event_id)
        .run();
    }
  }
  return result;
}

export const FOLLOWING_MILESTONES = [
  { eventType: 'friend_registered', days: 0, name: '友だち登録' },
  { eventType: 'friend_following_7d', days: 7, name: '継続フォロー7日' },
  { eventType: 'friend_following_30d', days: 30, name: '継続フォロー30日' },
  { eventType: 'friend_following_90d', days: 90, name: '継続フォロー90日' },
  { eventType: 'friend_following_180d', days: 180, name: '継続フォロー180日' },
  { eventType: 'friend_following_365d', days: 365, name: '継続フォロー1年' },
] as const;

/**
 * Materialize registration/continuous-follow milestones in bounded chunks.
 * Called on the existing 6-hour cron. Historic accounts are gradually caught
 * up without a full-table write spike; normal queue processing remains 5-minutely.
 * 機能オフ中のアカウントの節目は作らない。再オン後の新しい節目から再開する。
 */
export async function enqueueFollowingMileageMilestones(
  db: D1Database,
  options: { limitPerMilestone?: number; now?: string } = {},
): Promise<FollowingMileageReconcileResult> {
  const limit = Math.min(2000, Math.max(1, options.limitPerMilestone ?? 1000));
  const now = options.now ?? jstNow();
  const totals: FollowingMileageReconcileResult = { eventsCreated: 0, queued: 0 };

  for (const milestone of FOLLOWING_MILESTONES) {
    const anchorSql = milestone.days === 0 ? 'f.first_followed_at' : 'f.current_follow_started_at';
    const earnedAtSql = milestone.days === 0
      ? 'f.first_followed_at'
      : `datetime(f.current_follow_started_at, '+${milestone.days} days')`;
    const eventIdSql = `'loyalty:${milestone.eventType}:' || f.id || ':' || ${anchorSql}`;
    const sourceIdSql = `f.id || ':${milestone.eventType}:' || ${anchorSql}`;
    const eligibilitySql = milestone.days === 0
      ? 'f.first_followed_at IS NOT NULL'
      : `f.current_follow_started_at IS NOT NULL
         AND julianday(?) - julianday(f.current_follow_started_at) >= ${milestone.days}`;
    const insertBinds = milestone.days === 0 ? [now, limit] : [now, now, limit];

    const inserted = await db
      .prepare(
        `INSERT OR IGNORE INTO engagement_events
           (id, program_id, idempotency_key, event_type, source, source_event_id,
            actor_user_id, actor_friend_id, metadata, occurred_at, created_at)
         SELECT ${eventIdSql}, 'default',
                'line_relationship:${milestone.eventType}:' || ${sourceIdSql},
                '${milestone.eventType}', 'line_relationship', ${sourceIdSql},
                f.user_id, f.id,
                json_object('milestoneDays', ${milestone.days}, 'followStartedAt', ${anchorSql},
                            'subjectKey', ${sourceIdSql}),
                ${earnedAtSql}, ?
           FROM friends f
          WHERE f.is_following = 1
            AND ${eligibilitySql}
            AND NOT ${accountFeatureOffExclusionSql('f.line_account_id', 'mileage')}
            AND NOT EXISTS (
              SELECT 1 FROM engagement_events ee WHERE ee.id = ${eventIdSql}
            )
          ORDER BY ${anchorSql} ASC, f.id ASC
          LIMIT ?`,
      )
      .bind(...insertBinds)
      .run();
    totals.eventsCreated += inserted.meta?.changes ?? 0;

    const queued = await db
      .prepare(
        `INSERT OR IGNORE INTO mileage_event_queue
           (engagement_event_id, status, attempts, available_at,
            applied_published_snapshot, created_at, updated_at)
         SELECT ee.id, 'pending', 0, ?,
                (SELECT json_group_object(r.id, COALESCE(r.published_version_number, 0))
                   FROM friends f2
                   JOIN mileage_rules r ON r.line_account_id = f2.line_account_id
                  WHERE f2.id = ee.actor_friend_id),
                ?, ?
           FROM engagement_events ee
           LEFT JOIN friends f ON f.id = ee.actor_friend_id
          WHERE ee.event_type = ?
            AND ee.source = 'line_relationship'
            AND NOT ${accountFeatureOffExclusionSql('f.line_account_id', 'mileage')}
            AND NOT EXISTS (
              SELECT 1 FROM mileage_event_queue q WHERE q.engagement_event_id = ee.id
            )
          ORDER BY ee.occurred_at ASC, ee.id ASC
          LIMIT ?`,
      )
      .bind(now, now, now, milestone.eventType, limit)
      .run();
    totals.queued += queued.meta?.changes ?? 0;
  }
  return totals;
}
