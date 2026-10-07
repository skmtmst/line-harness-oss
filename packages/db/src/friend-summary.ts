import type { D1Database } from '@cloudflare/workers-types';
import type { FriendSummary } from '@line-crm/shared';

export async function getFriendSummary(
  db: D1Database, friendId: string, accountId: string | null, now = new Date(),
): Promise<FriendSummary> {
  const from = new Date(now.getTime() - 90 * 86400000).toISOString();
  const to = now.toISOString();
  const connector = accountId ? await db.prepare(
    'SELECT id FROM ec_connectors WHERE line_account_id = ?',
  ).bind(accountId).first() : null;
  let purchases: FriendSummary['purchases90Days'] = null;
  if (connector) {
    const rows = await db.prepare(`SELECT currency, COUNT(*) AS count,
      CASE WHEN COUNT(total_amount_minor) = COUNT(*) THEN
        SUM(MAX(0, total_amount_minor - COALESCE(refunded_amount_minor, 0))) ELSE NULL END AS amount
      FROM ec_orders WHERE friend_id = ? AND line_account_id = ?
        AND (normalized_status = 'current' OR (normalized_status = 'refunded'
          AND refunded_amount_minor IS NOT NULL AND total_amount_minor IS NOT NULL
          AND refunded_amount_minor < total_amount_minor))
        AND (COALESCE(refunded_amount_minor, 0) = 0 OR total_amount_minor IS NULL
          OR refunded_amount_minor < total_amount_minor)
        AND julianday(ordered_at) >= julianday(?) AND julianday(ordered_at) <= julianday(?)
      GROUP BY currency ORDER BY currency`).bind(friendId, accountId, from, to)
      .all<{ currency: string; count: number; amount: number | null }>();
    const currencies = rows.results.map(r => ({ currency: r.currency, count: r.count, totalAmountMinor: r.amount }));
    purchases = {
      count: currencies.reduce((total, r) => total + r.count, 0),
      totalAmountMinor: currencies.length === 0 ? 0 : currencies.length === 1 ? currencies[0].totalAmountMinor : null,
      currency: currencies.length === 1 ? currencies[0].currency : null,
      byCurrency: currencies,
    };
  }
  return {
    periodDays: 90, from, to,
    // LINE の開封集計は配信単位。個人との対応がなく分母に採用できない。
    deliveryOpenRate90Days: null,
    deliveryOpenMeasuredCount90Days: 0,
    purchases90Days: purchases,
  };
}
