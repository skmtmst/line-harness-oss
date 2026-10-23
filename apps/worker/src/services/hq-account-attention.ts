import type { HqAttentionCounts, HqAttentionKind } from '@line-crm/shared';

function attentionQueries(scope: '=?' | '=requested.id' | ' IN (SELECT id FROM requested)', includeAccount = false): Record<HqAttentionKind, string> {
  const account = includeAccount ? 'line_account_id,' : '';
  return {
    unhandledChats: `SELECT ${account}id,'/chats' href FROM chats WHERE line_account_id${scope} AND status IN('unread','in_progress','on_hold')`,
    pendingBookings: `SELECT ${account}id,'/booking/bookings' href FROM bookings WHERE line_account_id${scope} AND status='requested' UNION ALL SELECT ${account}id,'/events/bookings' href FROM event_bookings WHERE line_account_id${scope} AND status='requested' UNION ALL SELECT ${includeAccount ? 's.line_account_id,' : ''}r.id,'/restaurant-test/reservations' href FROM rt_reservations r JOIN rt_stores s ON s.id=r.store_id WHERE s.line_account_id${scope} AND r.status='pending' AND r.hold_expires_at IS NULL`,
    unpaid: `SELECT ${account}id FROM booking_payments WHERE line_account_id${scope} AND status IN('unpaid','pending','failed')`,
    connections: `SELECT ${account}id,'/accounts' href FROM line_account_connection_checks c WHERE line_account_id${scope} AND result IN('failed','mismatched','unconfigured') AND NOT EXISTS(SELECT 1 FROM line_account_connection_checks n WHERE n.line_account_id=c.line_account_id AND n.check_kind=c.check_kind AND n.checked_at>c.checked_at)`,
    stoppedDeliveries: `SELECT ${account}id,'/broadcasts' href FROM broadcasts WHERE line_account_id${scope} AND status IN('stopped','failed')`,
  };
}

type AttentionOverview = {
  counts: HqAttentionCounts;
  details: Record<string, Array<{ id: string; href?: string }>>;
};

/** Read all visible accounts with five statements; each category returns one detail at most. */
export async function readAccountsAttention(
  db: D1Database,
  accountIds: readonly string[],
): Promise<Map<string, AttentionOverview>> {
  const ids = [...new Set(accountIds)];
  const output = new Map<string, AttentionOverview>();
  if (ids.length === 0) return output;
  const entries = Object.entries(attentionQueries('=requested.id')) as Array<[HqAttentionKind, string]>;
  const scoped = attentionQueries(' IN (SELECT id FROM requested)', true);
  for (const id of ids) output.set(id, { counts: {} as HqAttentionCounts, details: {} });
  const results = await db.batch(entries.map(([kind, sql]) => {
    // Reuse each category's predicates and its existing representative selection.
    const detail = kind === 'unpaid' ? "json_object('id', sample.id)" : "json_object('id', sample.id, 'href', sample.href)";
    return db.prepare(`WITH requested(id) AS (SELECT CAST(value AS TEXT) FROM json_each(?)),
      totals AS (SELECT line_account_id,COUNT(*) count FROM (${scoped[kind]}) GROUP BY line_account_id)
      SELECT requested.id line_account_id,COALESCE(totals.count,0) count,
        (SELECT ${detail} FROM (${sql}) sample LIMIT 1) detail
      FROM requested LEFT JOIN totals ON totals.line_account_id=requested.id`).bind(JSON.stringify(ids));
  }));
  entries.forEach(([kind], index) => {
    for (const row of results[index].results as Array<{ line_account_id: string; count: number; detail: string | null }>) {
      const item = output.get(row.line_account_id)!;
      item.counts[kind] = row.count;
      item.details[kind] = row.detail ? [JSON.parse(row.detail) as { id: string; href?: string }] : [];
    }
  });
  return output;
}

/** 呼び出し元で、このアカウントが現在の可視範囲に属することを検証する。 */
export async function readAccountAttention(
  db: D1Database,
  a: string,
  includeDetails = true,
  detailLimit: 1 | 100 = 100,
) {
  const entries = Object.entries(attentionQueries('=?'));
  const statements = entries.flatMap(([kind, sql]) => {
    const bindings = Array.from(
      { length: kind === 'pendingBookings' ? 3 : 1 },
      () => a,
    );
    const count = db.prepare(`SELECT COUNT(*) count FROM (${sql})`).bind(...bindings);
    if (includeDetails) {
      return [count, db.prepare(sql + ` LIMIT ${detailLimit}`).bind(...bindings)];
    }
    // 件数から開く行き先は、明細の既存の行き先と分けて維持する。
    const targetSql = sql
      .replace("'/chats' href", "'/chats?status='||status href")
      .replace("'/booking/bookings' href", "'/booking/bookings?view=list&status=requested' href")
      .replace("'/events/bookings' href", "'/events/bookings?id='||event_id href")
      .replace("'/restaurant-test/reservations' href", "'/restaurant-test/reservations?view=list' href")
      .replace('SELECT id FROM booking_payments', "SELECT id,'/booking/menus?tab=payments&view=records' href FROM booking_payments");
    return [count, db.prepare(`SELECT href,COUNT(*) count FROM (${targetSql}) GROUP BY href ORDER BY href`).bind(...bindings)];
  });
  // 1アカウントの集計と行き先を1往復で読み、件数と明細の読み取り時点もそろえる。
  const results = await db.batch(statements);
  const targets: Partial<Record<HqAttentionKind, Array<{ href: string; count: number }>>> = {};
  const counts: Record<string, number> = {};
  const details: Record<string, unknown[]> = {};
  entries.forEach(([kind], index) => {
    counts[kind] = (results[index * 2].results[0] as { count: number } | undefined)?.count ?? 0;
    const rows = results[index * 2 + 1].results;
    if (includeDetails) {
      details[kind] = rows;
    } else {
      targets[kind as HqAttentionKind] = (rows as Array<{ href: string; count: number }>).map(
        target => target.href.startsWith('/events/bookings?id=')
          ? { ...target, href: '/events/bookings?id=' + encodeURIComponent(target.href.slice('/events/bookings?id='.length)) }
          : target,
      );
    }
  });
  return { counts: counts as HqAttentionCounts, details, targets };
}
