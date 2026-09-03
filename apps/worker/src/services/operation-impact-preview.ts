import type { Broadcast, OperationCapability } from '@line-crm/db';

import { getBroadcastAudiencePreview } from './broadcast-audience-preview.js';

export type OperationImpactMetric = {
  /** 停止対象になる設定・配信の数。 */
  itemCount: number;
  /** 現在の対象者数。将来の受信だけが対象、または読み取れない場合はnull。 */
  friendCount: number | null;
  pendingCount?: number;
  nearestScheduledAt?: string | null;
};

type PreviewCapability = Extract<OperationCapability,
  | 'broadcast_dispatch'
  | 'scenario_dispatch'
  | 'reminder_dispatch'
  | 'automation_actions'
  | 'auto_reply_dispatch'>;

export type OperationImpactPreview = Record<PreviewCapability, OperationImpactMetric>;

type CountRow = {
  item_count: number | null;
  friend_count: number | null;
  pending_count?: number | null;
};

function count(value: number | null | undefined): number {
  return Number(value ?? 0);
}

function earliestScheduledAt(values: Array<string | null>): string | null {
  let earliest: { value: string; time: number } | null = null;
  for (const value of values) {
    if (!value) continue;
    const time = Date.parse(value);
    if (!Number.isFinite(time)) continue;
    if (!earliest || time < earliest.time) earliest = { value, time };
  }
  return earliest?.value ?? null;
}

async function getActiveBroadcasts(db: D1Database, accountId: string | null): Promise<Broadcast[]> {
  const accountWhere = accountId
    ? `AND (
         b.line_account_id = ?
         OR (
           b.target_type = 'multi-account-dedup'
           AND EXISTS (
             SELECT 1
               FROM json_each(CASE WHEN json_valid(b.account_ids) THEN b.account_ids ELSE '[]' END)
              WHERE value = ?
           )
         )
       )`
    : '';
  const statement = db.prepare(
    `SELECT b.*
       FROM broadcasts b
      WHERE b.status IN ('scheduled', 'sending')
      ${accountWhere}
      ORDER BY COALESCE(b.scheduled_at, b.created_at), b.id`,
  );
  const result = accountId
    ? await statement.bind(accountId, accountId).all<Broadcast>()
    : await statement.all<Broadcast>();
  return result.results ?? [];
}

/** 新規の保存表を作らず、現在の配信台帳から影響を実測する。 */
export async function getOperationImpactPreview(
  db: D1Database,
  accountId: string | null,
): Promise<OperationImpactPreview> {
  const activeBroadcasts = await getActiveBroadcasts(db, accountId);
  const [broadcastAudiences, scenarioRow, reminderRow, automationRow, autoReplyRow] = await Promise.all([
    Promise.all(activeBroadcasts.map((broadcast) =>
      getBroadcastAudiencePreview(db, broadcast, accountId))),
    accountId
      ? db.prepare(
        `SELECT
           (SELECT COUNT(*) FROM scenarios
             WHERE is_active = 1 AND (line_account_id = ? OR line_account_id IS NULL)) AS item_count,
           (SELECT COUNT(DISTINCT fs.friend_id)
              FROM friend_scenarios fs
              JOIN scenarios s ON s.id = fs.scenario_id
              JOIN friends f ON f.id = fs.friend_id
             WHERE s.is_active = 1
               AND (s.line_account_id = ? OR s.line_account_id IS NULL)
               AND fs.status IN ('active', 'delivering')
               AND f.line_account_id = ?) AS friend_count`,
      ).bind(accountId, accountId, accountId).first<CountRow>()
      : db.prepare(
        `SELECT
           (SELECT COUNT(*) FROM scenarios WHERE is_active = 1) AS item_count,
           (SELECT COUNT(DISTINCT fs.friend_id)
              FROM friend_scenarios fs
              JOIN scenarios s ON s.id = fs.scenario_id
             WHERE s.is_active = 1 AND fs.status IN ('active', 'delivering')) AS friend_count`,
      ).first<CountRow>(),
    accountId
      ? db.prepare(
        `SELECT
           (SELECT COUNT(*) FROM reminders
             WHERE is_active = 1 AND deleted_at IS NULL AND line_account_id = ?) AS item_count,
           (SELECT COUNT(DISTINCT fr.friend_id)
              FROM friend_reminders fr
              JOIN reminders r ON r.id = fr.reminder_id
              JOIN friends f ON f.id = fr.friend_id
             WHERE r.is_active = 1 AND r.deleted_at IS NULL
               AND r.line_account_id = ? AND fr.status = 'active'
               AND f.line_account_id = ?) AS friend_count`,
      ).bind(accountId, accountId, accountId).first<CountRow>()
      : db.prepare(
        `SELECT
           (SELECT COUNT(*) FROM reminders WHERE is_active = 1 AND deleted_at IS NULL) AS item_count,
           (SELECT COUNT(DISTINCT fr.friend_id)
              FROM friend_reminders fr
              JOIN reminders r ON r.id = fr.reminder_id
             WHERE r.is_active = 1 AND r.deleted_at IS NULL AND fr.status = 'active') AS friend_count`,
      ).first<CountRow>(),
    accountId
      ? db.prepare(
        `SELECT COUNT(DISTINCT d.id) AS item_count,
                COUNT(DISTINCT CASE WHEN ar.status IN ('queued', 'running', 'waiting') THEN ar.friend_id END) AS friend_count,
                COUNT(DISTINCT CASE WHEN ar.status IN ('queued', 'running', 'waiting') THEN ar.id END) AS pending_count
           FROM automation_definitions d
           LEFT JOIN automation_runs ar ON ar.automation_id = d.id
          WHERE d.status = 'active' AND d.line_account_id = ?`,
      ).bind(accountId).first<CountRow>()
      : db.prepare(
        `SELECT COUNT(DISTINCT d.id) AS item_count,
                COUNT(DISTINCT CASE WHEN ar.status IN ('queued', 'running', 'waiting') THEN ar.friend_id END) AS friend_count,
                COUNT(DISTINCT CASE WHEN ar.status IN ('queued', 'running', 'waiting') THEN ar.id END) AS pending_count
           FROM automation_definitions d
           LEFT JOIN automation_runs ar ON ar.automation_id = d.id
          WHERE d.status = 'active'`,
      ).first<CountRow>(),
    accountId
      ? db.prepare(
        `SELECT COUNT(*) AS item_count, NULL AS friend_count
           FROM auto_replies
          WHERE is_active = 1 AND (line_account_id = ? OR line_account_id IS NULL)`,
      ).bind(accountId).first<CountRow>()
      : db.prepare(
        `SELECT COUNT(*) AS item_count, NULL AS friend_count
           FROM auto_replies
          WHERE is_active = 1`,
      ).first<CountRow>(),
  ]);

  const hasUnknownBroadcastAudience = broadcastAudiences.some((preview) => preview.count === null);
  const broadcastFriendCount = hasUnknownBroadcastAudience
    ? null
    : broadcastAudiences.reduce((sum, preview) => sum + count(preview.count), 0);

  return {
    broadcast_dispatch: {
      itemCount: activeBroadcasts.length,
      friendCount: broadcastFriendCount,
      nearestScheduledAt: earliestScheduledAt(activeBroadcasts.map((broadcast) => broadcast.scheduled_at)),
    },
    scenario_dispatch: {
      itemCount: count(scenarioRow?.item_count),
      friendCount: count(scenarioRow?.friend_count),
    },
    reminder_dispatch: {
      itemCount: count(reminderRow?.item_count),
      friendCount: count(reminderRow?.friend_count),
    },
    automation_actions: {
      itemCount: count(automationRow?.item_count),
      friendCount: count(automationRow?.friend_count),
      pendingCount: count(automationRow?.pending_count),
    },
    auto_reply_dispatch: {
      itemCount: count(autoReplyRow?.item_count),
      friendCount: null,
    },
  };
}
