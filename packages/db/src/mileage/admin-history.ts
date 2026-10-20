import { sqlIdSet } from '../id-queries.js';
import type { MileageHistoryTypeFilter, MileageHistoryKind } from '@line-crm/shared';
import { type MileageEntryType, type MileageEntryStatus, type MileageAdminHistory } from './types.js';
import { ensureDefaultMileageProgram } from './program.js';


/**
 * Return the append-only mileage ledger for people visible in one selected
 * LINE account. A verified user can have friends in several LINE accounts;
 * those ledger rows stay one wallet, but the link target always uses a friend
 * from the selected account. Unlinked friends never cross account boundaries.
 */
export async function getMileageAdminHistory(
  db: D1Database,
  options: {
    accountId: string;
    visibleAccountIds?: string[];
    search?: string;
    /**
     * V6R-CX-e: この友だちと同じ人（名寄せした複数アカウント）の履歴だけを返す。
     * 名前で探して100件から拾うと、同名が多いと本人がこぼれた。
     */
    friendId?: string;
    kind?: MileageHistoryKind;
    entryTypes?: MileageHistoryTypeFilter['entryTypes'];
    entryType?: MileageEntryType;
    status?: MileageEntryStatus;
    mode?: 'automatic' | 'manual';
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  },
): Promise<MileageAdminHistory> {
  await ensureDefaultMileageProgram(db);
  const accountId = options.accountId.trim();
  if (!accountId) throw new Error('Mileage history accountId is required');
  const search = (options.search ?? '').trim();
  const limit = Math.min(100, Math.max(1, options.limit ?? 50));
  const offset = Math.max(0, options.offset ?? 0);
  const visibleAccountIds = [...new Set([accountId, ...(options.visibleAccountIds ?? [])])];
  const visiblePlaceholders = sqlIdSet(visibleAccountIds).sql;

  const ctes = `WITH selected_profiles AS (
    SELECT CASE WHEN f.user_id IS NOT NULL THEN 'user:' || f.user_id ELSE 'friend:' || f.id END AS identity_key,
           MIN(f.id) AS primary_friend_id,
           COALESCE(MAX(u.display_name), MAX(f.display_name), '名前未設定') AS display_name,
           MAX(f.picture_url) AS picture_url,
           MAX(la.name) AS line_account_name
      FROM friends f
      LEFT JOIN users u ON u.id = f.user_id
      JOIN line_accounts la ON la.id = f.line_account_id
     WHERE f.line_account_id = ?
     GROUP BY identity_key
  ), ledger_rows AS (
    SELECT ml.*,
           CASE
             WHEN COALESCE(ml.beneficiary_user_id, bf.user_id) IS NOT NULL
               THEN 'user:' || COALESCE(ml.beneficiary_user_id, bf.user_id)
             ELSE 'friend:' || ml.beneficiary_friend_id
           END AS identity_key,
           SUM(CASE WHEN ml.status = 'available' THEN ml.amount ELSE 0 END) OVER (
             PARTITION BY CASE
               WHEN COALESCE(ml.beneficiary_user_id, bf.user_id) IS NOT NULL
                 THEN 'user:' || COALESCE(ml.beneficiary_user_id, bf.user_id)
               ELSE 'friend:' || ml.beneficiary_friend_id END
             ORDER BY ml.occurred_at, ml.created_at, ml.id ROWS UNBOUNDED PRECEDING
           ) AS balance_after
      FROM mileage_ledger ml
      LEFT JOIN friends bf ON bf.id = ml.beneficiary_friend_id
     WHERE ml.program_id = 'default'
       AND (
         bf.line_account_id IN (${visiblePlaceholders})
         OR (
           ml.beneficiary_friend_id IS NULL
           AND ml.beneficiary_user_id IS NOT NULL
           AND EXISTS (
             SELECT 1 FROM friends vf
              WHERE vf.user_id = ml.beneficiary_user_id
                AND vf.line_account_id IN (${visiblePlaceholders})
           )
         )
       )
  )`;
  const scopeBinds = [accountId, ...sqlIdSet(visibleAccountIds).binds, ...sqlIdSet(visibleAccountIds).binds];
  const searchColumn = options.friendId ? "lr.reason" : "sp.display_name";
  const where = [`(? = '' OR ${searchColumn} LIKE '%' || ? || '%')`];
  const filters: unknown[] = [search, search];
  if (options.friendId) {
    where.push(`sp.identity_key = (
      SELECT CASE WHEN f.user_id IS NOT NULL THEN 'user:' || f.user_id ELSE 'friend:' || f.id END
        FROM friends f WHERE f.id = ?
    )`);
    filters.push(options.friendId);
  }
  const earnedPredicate = "(lr.entry_type = 'grant' OR (lr.entry_type = 'adjustment' AND lr.amount > 0))";
  const friendPredicate = options.friendId ? where[1] : undefined;
  if (options.kind === 'earned') where.push(earnedPredicate);
  if (options.kind === 'spent') where.push("lr.entry_type = 'spend'");
  if (options.kind === 'voided') where.push(`NOT ${earnedPredicate} AND lr.entry_type != 'spend'`);
  if (options.entryType) {
    where.push('lr.entry_type = ?');
    filters.push(options.entryType);
  }
  if (options.entryTypes?.length) {
    where.push(`lr.entry_type IN (SELECT value FROM json_each(?))`);
    filters.push(JSON.stringify(options.entryTypes));
  }
  if (options.status) {
    where.push('lr.status = ?');
    filters.push(options.status);
  }
  if (options.mode === 'manual') {
    where.push("(lr.entry_type = 'adjustment' OR lr.source IN ('manual', 'admin_adjustment'))");
  } else if (options.mode === 'automatic') {
    where.push("NOT (lr.entry_type = 'adjustment' OR lr.source IN ('manual', 'admin_adjustment'))");
  }
  if (options.from) {
    where.push("date(lr.occurred_at, '+9 hours') >= date(?)");
    filters.push(options.from);
  }
  if (options.to) {
    where.push("date(lr.occurred_at, '+9 hours') <= date(?)");
    filters.push(options.to);
  }
  const whereSql = where.join(' AND ');

  const [rows, count, friendMetrics] = await Promise.all([
    db
      .prepare(
        `${ctes}
         SELECT lr.id, sp.primary_friend_id, sp.display_name, sp.picture_url, sp.line_account_name,
                lr.entry_type, lr.status, lr.amount, lr.reason, lr.source,
                lr.source_event_id, mr.name AS rule_name,
                json_extract(lr.metadata, '$.sourceReferenceId') AS source_reference_id,
                json_extract(lr.metadata, '$.executedByStaffName') AS executed_by_staff_name,
                json_extract(lr.metadata, '$.lineAccountId') AS line_account_id,
                an.status AS notification_status,
                an.error_code AS notification_error_code,
                lr.occurred_at, lr.balance_after
           FROM ledger_rows lr
           INNER JOIN selected_profiles sp ON sp.identity_key = lr.identity_key
           LEFT JOIN mileage_rules mr ON mr.id = lr.mileage_rule_id
           LEFT JOIN mileage_adjustment_notifications an ON an.ledger_entry_id = lr.id
          WHERE ${whereSql}
          ORDER BY lr.occurred_at DESC, lr.created_at DESC, lr.id DESC
          LIMIT ? OFFSET ?`,
      )
      .bind(...scopeBinds, ...filters, limit, offset)
      .all<{
        id: string;
        primary_friend_id: string;
        display_name: string;
        picture_url: string | null;
        entry_type: MileageEntryType;
        status: MileageEntryStatus;
        amount: number;
        reason: string;
        source: string;
        source_event_id: string | null;
        source_reference_id: string | null;
        rule_name: string | null;
        executed_by_staff_name: string | null;
        line_account_id: string | null;
        notification_status: string | null;
        notification_error_code: string | null;
        occurred_at: string;
        line_account_name: string;
        balance_after: number;
      }>(),
    db
      .prepare(
        `${ctes}
         SELECT COUNT(*) AS total
           FROM ledger_rows lr
           INNER JOIN selected_profiles sp ON sp.identity_key = lr.identity_key
          WHERE ${whereSql}`,
      )
      .bind(...scopeBinds, ...filters)
      .first<{ total: number }>(),
    friendPredicate ? db.prepare(`${ctes}
      SELECT COUNT(*) AS total,
        SUM(CASE WHEN ${earnedPredicate} THEN 1 ELSE 0 END) AS earned,
        SUM(CASE WHEN lr.entry_type = 'spend' THEN 1 ELSE 0 END) AS spent,
        SUM(CASE WHEN lr.status = 'pending' THEN 1 ELSE 0 END) AS pending,
        date('now', '+9 hours', 'start of month') AS month_from,
        SUM(CASE WHEN ${earnedPredicate} AND date(lr.occurred_at, '+9 hours') >= date('now', '+9 hours', 'start of month')
          AND date(lr.occurred_at, '+9 hours') < date('now', '+9 hours', 'start of month', '+1 month')
          THEN MAX(0, lr.amount) ELSE 0 END) AS month_amount,
        SUM(CASE WHEN ${earnedPredicate} AND date(lr.occurred_at, '+9 hours') >= date('now', '+9 hours', 'start of month')
          AND date(lr.occurred_at, '+9 hours') < date('now', '+9 hours', 'start of month', '+1 month')
          THEN 1 ELSE 0 END) AS month_count
      FROM ledger_rows lr JOIN selected_profiles sp ON sp.identity_key = lr.identity_key
      WHERE ${friendPredicate}`).bind(...scopeBinds, options.friendId).first<{
        total: number; earned: number; spent: number; pending: number; month_from: string; month_amount: number; month_count: number;
      }>() : Promise.resolve(null),
  ]);

  return {
    ...(friendMetrics ? { friendSummary: {
      scope: 'visible_accounts' as const,
      counts: { all: Number(friendMetrics.total), earned: Number(friendMetrics.earned ?? 0),
        spent: Number(friendMetrics.spent ?? 0),
        voided: Number(friendMetrics.total) - Number(friendMetrics.earned ?? 0) - Number(friendMetrics.spent ?? 0) },
      pendingCount: Number(friendMetrics.pending ?? 0), monthFrom: friendMetrics.month_from,
      earnedThisMonth: Number(friendMetrics.month_amount ?? 0), earnedCountThisMonth: Number(friendMetrics.month_count ?? 0),
    } } : {}),
    items: rows.results.map((row) => ({
      id: row.id,
      primaryFriendId: row.primary_friend_id,
      displayName: row.display_name,
      pictureUrl: row.picture_url,
      entryType: row.entry_type,
      status: row.status,
      amount: Number(row.amount),
      reason: row.reason,
      source: row.source,
      hasSourceEvent: Boolean(row.source_event_id),
      sourceReferenceId: row.source_reference_id,
      ruleName: row.rule_name,
      mode: row.entry_type === 'adjustment' || row.source === 'manual' || row.source === 'admin_adjustment'
        ? 'manual'
        : 'automatic',
      executedByStaffName: row.executed_by_staff_name,
      lineAccountName: row.line_account_name,
      lineAccountId: row.line_account_id,
      notificationStatus: row.notification_status,
      notificationErrorCode: row.notification_error_code,
      balanceAfter: Number(row.balance_after ?? 0),
      occurredAt: row.occurred_at,
    })),
    pagination: { total: Number(count?.total ?? 0), limit, offset },
  };
}
