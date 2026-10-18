import { styleWindow } from './style-analytics.js';
import { countMetric, missing, ratio } from './style-analytics-core.js';
import type { EcStyleSummary } from '@line-crm/shared';

/** Read the existing order projection; mock auto-LINE results are deliberately not an input. */
export async function ecStyleSummary(db: D1Database, account: string, query: Record<string, string | undefined>, now = new Date()): Promise<EcStyleSummary> {
  const window = await styleWindow(db, account, query, now.getTime());
  const connector = await db.prepare('SELECT status,updated_at FROM ec_connectors WHERE line_account_id=?')
    .bind(account).first<{ status: string; updated_at: string }>();
  const latest = await db.prepare('SELECT MAX(updated_at) AS as_of FROM ec_orders WHERE line_account_id=?')
    .bind(account).first<{ as_of: string | null }>();
  const configured = !!connector || !!latest?.as_of;
  const result: EcStyleSummary = {
    style: 'ec', from: window.from, to: window.to, timeZone: window.timeZone, range: window.range,
    asOf: latest?.as_of ?? null, computedAt: now.toISOString(), dateBasis: 'ordered_at',
    status: !configured ? 'unconfigured' : !latest?.as_of ? 'unavailable' : connector && connector.status !== 'connected' ? 'stale' : 'available',
    orders: missing('期間内の取消・返金を除く注文数'),
    repeatCustomers: { ...missing('期間内の購入者のうち、同じ連携元で期間終了までに2回以上購入した人の割合'), unit: '割合' },
    changeAt: '/ec-commerce?tab=connector', ordersAt: '/ec-commerce?tab=orders', autoLineAt: '/ec-commerce?tab=auto-line',
  };
  if (!latest?.as_of) return result;
  const row = await db.prepare(`
    WITH period_orders AS (
      SELECT source_key,customer_id FROM ec_orders
      WHERE line_account_id=? AND normalized_status='current'
        AND julianday(ordered_at)>=julianday(?) AND julianday(ordered_at)<julianday(?)
    ), customers AS (
      SELECT DISTINCT source_key,customer_id FROM period_orders WHERE customer_id IS NOT NULL AND customer_id<>''
    )
    SELECT (SELECT COUNT(*) FROM period_orders) AS orders,
      COUNT(*) AS customers,
      COALESCE(SUM(CASE WHEN (SELECT COUNT(*) FROM ec_orders o WHERE o.line_account_id=?
        AND o.source_key=c.source_key AND o.customer_id=c.customer_id AND o.normalized_status='current'
        AND julianday(o.ordered_at)<julianday(?))>=2 THEN 1 ELSE 0 END),0) AS repeat_customers
    FROM customers c
  `).bind(account, window.from, window.to, account, window.to).first<{ orders: number; customers: number; repeat_customers: number }>();
  if (!row) throw new Error('ec_summary_unavailable');
  result.orders = countMetric(row.orders, result.orders.formula);
  result.repeatCustomers = ratio(row.repeat_customers, row.customers, result.repeatCustomers.formula);
  return result;
}
