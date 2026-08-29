import { getBroadcasts, type OperationCapability } from '@line-crm/db';
import { getBroadcastAudiencePreview } from './broadcast-audience-preview.js';

export type OperationImpactMetric = {
  /** 停止対象になる設定・配信の数。 */
  itemCount: number;
  /** 現在その設定の中で動いている友だち。将来の受信だけが対象ならnull。 */
  friendCount: number | null;
  /** すでに作られていて、次の実行を待っている記録。 */
  pendingCount?: number;
  nearestScheduledAt?: string | null;
};

export type OperationImpactPreview = Record<
  Extract<OperationCapability,
    | 'broadcast_dispatch'
    | 'scenario_dispatch'
    | 'reminder_dispatch'
    | 'automation_actions'
    | 'auto_reply_dispatch'>,
  OperationImpactMetric
>;

type CountRow = {
  item_count: number | null;
  friend_count: number | null;
  pending_count?: number | null;
};

function number(value: number | null | undefined): number {
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

/**
 * 緊急停止の確認に、既存の配信台帳から実測値だけを返す。
 * 保存用の新しい表は作らず、未取得を0人へ潰さない。
 */
export async function getOperationImpactPreview(
  db: D1Database,
  accountId: string | null,
): Promise<OperationImpactPreview> {
  const allBroadcasts = await getBroadcasts(db, accountId ?? undefined);
  const activeBroadcasts = allBroadcasts.filter((broadcast) =>
    broadcast.status === 'scheduled' || broadcast.status === 'sending');

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
               AND fs.status IN ('active', 'delivering')
               AND f.line_account_id = ?) AS friend_count`,
      ).bind(accountId, accountId).first<CountRow>()
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
           (SELECT COUNT(*) FROM reminders WHERE is_active = 1 AND line_account_id = ?) AS item_count,
           (SELECT COUNT(DISTINCT fr.friend_id)
              FROM friend_reminders fr
              JOIN reminders r ON r.id = fr.reminder_id
              JOIN friends f ON f.id = fr.friend_id
             WHERE r.is_active = 1 AND fr.status = 'active' AND f.line_account_id = ?) AS friend_count`,
      ).bind(accountId, accountId).first<CountRow>()
      : db.prepare(
        `SELECT
           (SELECT COUNT(*) FROM reminders WHERE is_active = 1) AS item_count,
           (SELECT COUNT(DISTINCT fr.friend_id)
              FROM friend_reminders fr
              JOIN reminders r ON r.id = fr.reminder_id
             WHERE r.is_active = 1 AND fr.status = 'active') AS friend_count`,
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
    : broadcastAudiences.reduce((sum, preview) => sum + number(preview.count), 0);

  return {
    broadcast_dispatch: {
      itemCount: activeBroadcasts.length,
      friendCount: broadcastFriendCount,
      nearestScheduledAt: earliestScheduledAt(activeBroadcasts.map((broadcast) => broadcast.scheduled_at)),
    },
    scenario_dispatch: {
      itemCount: number(scenarioRow?.item_count),
      friendCount: number(scenarioRow?.friend_count),
    },
    reminder_dispatch: {
      itemCount: number(reminderRow?.item_count),
      friendCount: number(reminderRow?.friend_count),
    },
    automation_actions: {
      itemCount: number(automationRow?.item_count),
      friendCount: number(automationRow?.friend_count),
      pendingCount: number(automationRow?.pending_count),
    },
    auto_reply_dispatch: {
      itemCount: number(autoReplyRow?.item_count),
      friendCount: null,
    },
  };
}
