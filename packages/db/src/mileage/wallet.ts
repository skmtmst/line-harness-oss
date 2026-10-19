import { sqlIdSet } from '../id-queries.js';
import { DEFAULT_MILEAGE_PROGRAM_ID, ensureBuiltInProgram } from './program.js';
import { type MileageSummary, type MileageHistoryItem, type MileageEntryType, type MileageEntryStatus, type MileageSelfInsights, type MileageConnectedAccount } from './types.js';


export const FRIEND_WALLET_SCOPE_SQL = `(
  ml.beneficiary_friend_id = ?
  OR (
    identity.user_id IS NOT NULL
    AND (
      ml.beneficiary_user_id = identity.user_id
      OR ml.beneficiary_friend_id IN (
        SELECT linked.id FROM friends linked WHERE linked.user_id = identity.user_id
      )
    )
  )
)`;

/**
 * Resolve a wallet through friends.user_id when available. This makes balances
 * follow the same person across multiple LINE accounts without rewriting old
 * ledger rows; an unlinked friend still has a safe friend-scoped wallet.
 */
/**
 * m22u R360：交換の内訳選びと同じ「使える」基準。
 * 期限切れロットの残数は、台帳に残っていても使えない。残高からも外す。
 * 比較は交換予約と同じ now で行い、基準のずれを作らない。
 */
export function expiredLotHoldbackSql(): string {
  return `COALESCE((
           SELECT SUM(l.remaining_amount) FROM mileage_grant_lots l
            WHERE l.program_id = mp.id
              AND l.status = 'available'
              AND l.remaining_amount > 0
              AND l.expires_at IS NOT NULL AND l.expires_at <= ?
              AND (l.beneficiary_key = 'friend:' || ?
                   OR l.beneficiary_key = 'user:' || (SELECT user_id FROM friends WHERE id = ?))
         ), 0)`;
}

export async function getMileageSummaryForFriend(
  db: D1Database,
  friendId: string,
  programId = DEFAULT_MILEAGE_PROGRAM_ID,
  now = new Date().toISOString(),
): Promise<MileageSummary> {
  await ensureBuiltInProgram(db, programId);
  const row = await db
    .prepare(
      `WITH identity AS (
         SELECT user_id FROM friends WHERE id = ?
       )
       SELECT mp.name AS program_name,
              COALESCE(SUM(CASE WHEN ml.status = 'available' THEN ml.amount ELSE 0 END), 0)
                - ${expiredLotHoldbackSql()} AS available,
              COALESCE(SUM(CASE WHEN ml.status = 'pending' THEN ml.amount ELSE 0 END), 0) AS pending,
              COALESCE(SUM(CASE WHEN ml.entry_type = 'grant' AND ml.amount > 0
                                THEN ml.amount ELSE 0 END), 0) AS lifetime_earned,
              COALESCE(-SUM(CASE WHEN ml.entry_type = 'spend' AND ml.amount < 0
                                 THEN ml.amount ELSE 0 END), 0) AS spent
         FROM mileage_programs mp
         LEFT JOIN identity ON 1 = 1
         LEFT JOIN mileage_ledger ml
           ON ml.program_id = mp.id
          AND ${FRIEND_WALLET_SCOPE_SQL}
        WHERE mp.id = ?
        GROUP BY mp.id, mp.name`,
    )
    .bind(friendId, now, friendId, friendId, friendId, programId)
    .first<{
      program_name: string;
      available: number;
      pending: number;
      lifetime_earned: number;
      spent: number;
    }>();

  if (!row) throw new Error(`Mileage program not found: ${programId}`);
  return {
    programId,
    programName: row.program_name,
    available: Number(row.available),
    pending: Number(row.pending),
    lifetimeEarned: Number(row.lifetime_earned),
    spent: Number(row.spent),
  };
}

export async function getMileageHistoryForFriend(
  db: D1Database,
  friendId: string,
  options: { programId?: string; limit?: number; visibleAccountIds?: string[] } = {},
): Promise<MileageHistoryItem[]> {
  const programId = options.programId ?? DEFAULT_MILEAGE_PROGRAM_ID;
  await ensureBuiltInProgram(db, programId);
  const limit = Math.min(100, Math.max(1, options.limit ?? 20));
  const visible = options.visibleAccountIds ? new Set(options.visibleAccountIds) : null;
  const result = await db
    .prepare(
      `WITH identity AS (
         SELECT user_id FROM friends WHERE id = ?
       )
       SELECT ml.id, ml.entry_type, ml.status, ml.amount, ml.reason,
              ml.source, ml.source_event_id, mr.name AS rule_name,
              json_extract(ml.metadata, '$.sourceReferenceId') AS source_reference_id,
              json_extract(ml.metadata, '$.executedByStaffName') AS executed_by_staff_name,
              json_extract(ml.metadata, '$.lineAccountId') AS metadata_account_id,
              bf.line_account_id AS entry_account_id,
              man.status AS notification_status,
              man.error_code AS notification_error_code,
              ml.occurred_at
         FROM mileage_ledger ml
         LEFT JOIN identity ON 1 = 1
         LEFT JOIN mileage_rules mr ON mr.id = ml.mileage_rule_id
         LEFT JOIN friends bf ON bf.id = ml.beneficiary_friend_id
         LEFT JOIN mileage_adjustment_notifications man ON man.ledger_entry_id = ml.id
        WHERE ml.program_id = ?
          AND ${FRIEND_WALLET_SCOPE_SQL}
        ORDER BY ml.occurred_at DESC, ml.created_at DESC, ml.id DESC
        LIMIT ?`,
    )
    .bind(friendId, programId, friendId, limit)
    .all<{
      id: string;
      entry_type: MileageEntryType;
      status: MileageEntryStatus;
      amount: number;
      reason: string;
      source: string;
      source_event_id: string | null;
      source_reference_id: string | null;
      rule_name: string | null;
      executed_by_staff_name: string | null;
      metadata_account_id: string | null;
      entry_account_id: string | null;
      notification_status: string | null;
      notification_error_code: string | null;
      occurred_at: string;
    }>();

  return result.results.map((row) => {
    const lineAccountId = row.metadata_account_id ?? row.entry_account_id;
    /*
     * 所属アカウントが分からない行も伏せる。分からない以上「見てよい」
     * とは証明できないため、権限の外側と同じ扱いにする（安全側）。
     */
    const restricted = visible !== null && (lineAccountId === null || !visible.has(lineAccountId));
    return {
      id: row.id,
      entryType: row.entry_type,
      status: row.status,
      amount: row.amount,
      reason: restricted ? null : row.reason,
      source: row.source,
      sourceEventId: restricted ? null : row.source_event_id,
      sourceReferenceId: restricted ? null : row.source_reference_id,
      ruleName: restricted ? null : row.rule_name,
      mode: row.entry_type === 'adjustment' || row.source === 'manual' || row.source === 'admin_adjustment'
        ? 'manual'
        : 'automatic',
      executedByStaffName: restricted ? null : row.executed_by_staff_name,
      occurredAt: row.occurred_at,
      lineAccountId,
      restricted,
      // R380: 通知の失敗は履歴の行から再送できるように、状態だけを返す。
      // 権限外アカウントの行では通知の有無も伏せる。
      notificationStatus: restricted ? null : row.notification_status,
      notificationErrorCode: restricted ? null : row.notification_error_code,
    };
  });
}

/**
 * Personal mileage-page counters for one verified friend.
 *
 * The wallet scope deliberately matches getMileageSummaryForFriend: once a
 * friend is linked to a canonical users.id, activity from every connected LINE
 * Official Account is shown as one wallet. Unlinked friends remain isolated to
 * their own friend row.
 */
export async function getMileageSelfInsights(
  db: D1Database,
  friendId: string,
  programId = DEFAULT_MILEAGE_PROGRAM_ID,
): Promise<MileageSelfInsights> {
  await ensureBuiltInProgram(db, programId);
  const row = await db
    .prepare(
      `WITH identity AS (
         SELECT user_id FROM friends WHERE id = ?
       ), friend_scope AS (
         SELECT f.id, f.line_account_id
           FROM friends f
           LEFT JOIN identity ON 1 = 1
          WHERE f.id = ?
             OR (identity.user_id IS NOT NULL AND f.user_id = identity.user_id)
       )
       SELECT (SELECT COUNT(DISTINCT line_account_id) FROM friend_scope) AS account_count,
              COUNT(CASE
                WHEN ml.entry_type = 'grant' AND ml.status != 'void' THEN 1
                ELSE NULL END) AS rewarded_actions,
              COALESCE(SUM(CASE
                WHEN ml.status = 'available'
                 AND (ml.source = 'tag_referral'
                      OR json_extract(ml.metadata, '$.beneficiaryType') = 'referrer')
                THEN ml.amount ELSE 0 END), 0) AS referral_miles,
              COUNT(DISTINCT CASE
                WHEN ml.entry_type = 'grant'
                 AND ml.status != 'void'
                 AND (ml.source = 'tag_referral'
                      OR json_extract(ml.metadata, '$.beneficiaryType') = 'referrer')
                THEN COALESCE(json_extract(ml.metadata, '$.referredUserId'),
                              json_extract(ml.metadata, '$.referredFriendId'))
                ELSE NULL END) AS quality_referral_count,
              MAX(CASE
                WHEN ml.entry_type = 'grant' AND ml.status != 'void'
                THEN ml.occurred_at ELSE NULL END) AS last_earned_at
         FROM mileage_ledger ml
         LEFT JOIN identity ON 1 = 1
        WHERE ml.program_id = ?
          AND ${FRIEND_WALLET_SCOPE_SQL}`,
    )
    .bind(friendId, friendId, programId, friendId)
    .first<{
      account_count: number;
      rewarded_actions: number;
      referral_miles: number;
      quality_referral_count: number;
      last_earned_at: string | null;
    }>();

  return {
    accountCount: Number(row?.account_count ?? 0),
    rewardedActions: Number(row?.rewarded_actions ?? 0),
    referralMiles: Number(row?.referral_miles ?? 0),
    qualityReferralCount: Number(row?.quality_referral_count ?? 0),
    lastEarnedAt: row?.last_earned_at ?? null,
  };
}

/**
 * List only connected accounts the authenticated operator may see. The caller
 * provides its resolved account scope so a verified cross-account wallet does
 * not reveal a hidden account name or friend id.
 */
export async function getMileageConnectedAccountsForFriend(
  db: D1Database,
  friendId: string,
  allowedAccountIds: string[],
): Promise<MileageConnectedAccount[]> {
  if (allowedAccountIds.length === 0) return [];
  const placeholders = sqlIdSet(allowedAccountIds).sql;
  const rows = await db
    .prepare(
      `WITH identity AS (
         SELECT user_id FROM friends WHERE id = ?
       )
       SELECT f.line_account_id AS account_id,
              COALESCE(la.name, '名前未設定') AS account_name,
              f.id AS friend_id
         FROM friends f
         LEFT JOIN identity ON 1 = 1
         LEFT JOIN line_accounts la ON la.id = f.line_account_id
        WHERE f.line_account_id IN (${placeholders})
          AND (f.id = ? OR (identity.user_id IS NOT NULL AND f.user_id = identity.user_id))
        ORDER BY COALESCE(la.display_order, 0) ASC, account_name ASC, f.id ASC`,
    )
    .bind(friendId, ...(allowedAccountIds.length ? sqlIdSet(allowedAccountIds).binds : []), friendId)
    .all<{ account_id: string; account_name: string; friend_id: string }>();
  return rows.results.map((row) => ({
    accountId: row.account_id,
    accountName: row.account_name,
    friendId: row.friend_id,
  }));
}
