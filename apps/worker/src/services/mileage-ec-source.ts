import { getNenRankSettings } from '@line-crm/db';
export { resolveMileageSource } from '@line-crm/db/src/mileage/index.js';

type Input = { lineAccountId: string; search: string; friendId?: string; limit: number; offset: number };
export async function hasHeldMileageRedemption(db: D1Database, accountId: string, friendId: string): Promise<boolean> {
  const row = await db.prepare(`SELECT 1 AS present FROM mileage_redemptions
    WHERE line_account_id = ? AND beneficiary_friend_id = ? AND status IN ('reserved','delivering','delivery_failed') LIMIT 1`)
    .bind(accountId, friendId).first<{ present: number }>();
  return row?.present === 1;
}
export async function getEcMileageBalance(db: D1Database, accountId: string, friendId: string): Promise<number | null> {
  const row = await db.prepare(`SELECT s.mile_balance FROM nen_ec_member_snapshots s JOIN friends f ON f.id = s.friend_id WHERE f.line_account_id = ? AND f.id = ?`).bind(accountId, friendId).first<{ mile_balance: number }>();
  return row == null ? null : Number(row.mile_balance);
}
/** 会員スナップショットがない友だちは残高不明。musubo の財布で埋めない。 */
export async function getEcMileageFriends(db: D1Database, input: Input) {
  const where = `f.line_account_id = ? AND (? = '' OR f.display_name LIKE '%' || ? || '%') AND (? = '' OR f.id = ?)`;
  const filter = [input.lineAccountId, input.search, input.search, input.friendId ?? '', input.friendId ?? ''];
  const [ranks, rows, counts, totals] = await Promise.all([
    getNenRankSettings(db, input.lineAccountId),
    db.prepare(`SELECT f.id, f.display_name, f.picture_url, f.user_id, a.name AS account_name,
        s.friend_id AS snapshot_id, s.mile_balance, s.member_rank_key, s.ec_member_rank_name, s.synced_at
      FROM friends f JOIN line_accounts a ON a.id = f.line_account_id
      LEFT JOIN nen_ec_member_snapshots s ON s.friend_id = f.id
      WHERE ${where} ORDER BY s.mile_balance IS NULL, s.mile_balance DESC, f.display_name, f.id LIMIT ? OFFSET ?`)
      .bind(...filter, input.limit, input.offset).all<Record<string, unknown>>(),
    db.prepare(`SELECT COUNT(*) AS total FROM friends f WHERE ${where}`).bind(...filter).first<{ total: number }>(),
    db.prepare(`SELECT COUNT(*) AS total, COUNT(s.friend_id) AS known, SUM(CASE WHEN s.mile_balance > 0 THEN 1 ELSE 0 END) AS with_balance,
        COALESCE(SUM(s.mile_balance), 0) AS balance FROM friends f LEFT JOIN nen_ec_member_snapshots s ON s.friend_id = f.id
      WHERE f.line_account_id = ?`).bind(input.lineAccountId).first<{ total: number; known: number; with_balance: number; balance: number }>(),
  ]);
  return {
    balanceSource: 'ec' as const,
    ecKnownCount: Number(totals?.known ?? 0),
    summary: { totalMembers: Number(totals?.total ?? 0), withBalanceCount: Number(totals?.with_balance ?? 0), available: Number(totals?.known ?? 0) > 0 ? Number(totals?.balance ?? 0) : null, pending: 0, monthChange: 0, rankCounts: [], expiringMiles30d: null, nextExpiringAt: null },
    items: rows.results.map((row) => {
      const key = typeof row.member_rank_key === 'string' && row.member_rank_key.trim() ? row.member_rank_key.trim() : null;
      const rank = key ? ranks.find((r) => r.rank_key === key)?.name ?? (typeof row.ec_member_rank_name === 'string' && row.ec_member_rank_name.trim() ? row.ec_member_rank_name : null) : null;
      const balance = row.snapshot_id == null ? null : Number(row.mile_balance);
      return { friendId: String(row.id), displayName: String(row.display_name || '名前未設定'), pictureUrl: row.picture_url ?? null,
        rank: rank ?? '未設定', rankReason: 'ECと同期', rankThreshold: null, nextRank: null, nextRankThreshold: null, milesToNextRank: null,
        available: balance, ecBalance: balance, pending: 0, monthChange: 0, expiringMiles30d: null, nextExpiringAt: null,
        lifetimeEarned: 0, spent: 0, lastChangedAt: row.synced_at ?? null, lastAction: null,
        walletScope: row.user_id ? 'verified_user' as const : 'friend' as const,
        lineAccount: { id: input.lineAccountId, name: String(row.account_name) } };
    }),
    pagination: { total: Number(counts?.total ?? 0), limit: input.limit, offset: input.offset },
    measuredAt: new Date().toISOString(),
  };
}
