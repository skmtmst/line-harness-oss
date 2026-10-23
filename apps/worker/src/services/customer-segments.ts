import { jstDate as japanDate } from '@line-crm/shared';
import { SCHEDULED_WORK_BUDGET_MS, withScheduledWorkLease } from './scheduled-work-lease.js';
/** Daily snapshots are rebuilt atomically; a failed rebuild leaves yesterday's values intact. */
export async function refreshCustomerSegments(db:D1Database,a:string,now=new Date()){
 const at=now.toISOString(),from=new Date(now.getTime()-365*86400000).toISOString();
 const source=`WITH activities AS (
 SELECT b.friend_id,'visit' basis,b.starts_at at,b.price_at_booking amount FROM bookings b
 WHERE b.line_account_id=? AND b.friend_id IS NOT NULL AND b.status NOT IN('cancelled','rejected','no_show') AND (SELECT kind FROM booking_visit_marks v WHERE v.booking_id=b.id ORDER BY julianday(v.marked_at) DESC,v.id DESC LIMIT 1)='visited'
 UNION ALL SELECT friend_id,'purchase',ordered_at,MAX(0,COALESCE(total_amount_minor,0)-COALESCE(refunded_amount_minor,0)) FROM ec_orders WHERE line_account_id=? AND normalized_status='current' AND currency='JPY' AND friend_id IS NOT NULL
 ), expanded AS(SELECT * FROM activities UNION ALL SELECT friend_id,'both',at,amount FROM activities),
 agg AS(SELECT f.id friend_id,b.basis,COUNT(CASE WHEN julianday(x.at)>=julianday(?) AND julianday(x.at)<=julianday(?) THEN 1 END) activity_count,COALESCE(SUM(CASE WHEN julianday(x.at)>=julianday(?) AND julianday(x.at)<=julianday(?) THEN x.amount ELSE 0 END),0) amount,MAX(CASE WHEN julianday(x.at)<=julianday(?) THEN x.at END) last_activity_at FROM friends f CROSS JOIN (SELECT 'visit' basis UNION ALL SELECT 'purchase' UNION ALL SELECT 'both') b LEFT JOIN expanded x ON x.friend_id=f.id AND x.basis=b.basis WHERE f.line_account_id=? GROUP BY f.id,b.basis),
 buckets AS(SELECT *,CASE WHEN last_activity_at IS NULL THEN NULL WHEN julianday(?)-julianday(last_activity_at)<=30 THEN 1 WHEN julianday(?)-julianday(last_activity_at)<=60 THEN 2 WHEN julianday(?)-julianday(last_activity_at)<=90 THEN 3 WHEN julianday(?)-julianday(last_activity_at)<=180 THEN 4 ELSE 5 END r,
 CASE WHEN last_activity_at IS NULL THEN NULL WHEN activity_count<=1 THEN 1 WHEN activity_count=2 THEN 2 WHEN activity_count<=4 THEN 3 WHEN activity_count<=9 THEN 4 ELSE 5 END f FROM agg)
 INSERT INTO customer_activity_daily(account_id,friend_id,basis,activity_count,amount,last_activity_at,r_bucket,f_bucket,m_bucket,computed_at)
 SELECT ?,friend_id,basis,activity_count,amount,last_activity_at,r,f,CASE WHEN last_activity_at IS NULL THEN NULL ELSE 1 END,? FROM buckets`;
 await db.batch([db.prepare('DELETE FROM customer_activity_daily WHERE account_id=?').bind(a),db.prepare(source).bind(a,a,from,at,from,at,at,a,at,at,at,at,a,at),
 db.prepare(`WITH ranked AS(SELECT friend_id,basis,MIN(5,1+CAST(5*percent_rank() OVER(PARTITION BY basis ORDER BY amount) AS INTEGER)) bucket FROM customer_activity_daily WHERE account_id=? AND last_activity_at IS NOT NULL) UPDATE customer_activity_daily AS c SET m_bucket=(SELECT bucket FROM ranked r WHERE r.friend_id=c.friend_id AND r.basis=c.basis) WHERE account_id=? AND last_activity_at IS NOT NULL`).bind(a,a),db.prepare("INSERT INTO customer_activity_runs(account_id,computed_at,last_attempt_at,status) VALUES(?,?,?,'ready') ON CONFLICT(account_id) DO UPDATE SET computed_at=excluded.computed_at,last_attempt_at=excluded.last_attempt_at,status='ready'").bind(a,at,at)]);
}
export function segmentName(r:number,f:number){return r===1&&f===5?'常連':r===1&&f===1?'新しい人':r>=4&&f>=4?'離れかけの常連':r===5&&f<=2?'眠っている':`最後の日 ${r}・回数 ${f}`;}
export const CUSTOMER_SEGMENT_BATCH_SIZE = 5;

export async function processCustomerSegments(db: D1Database, now = new Date()) {
  return withScheduledWorkLease(db, 'customer-segments', async (lease) => {
    const started = Date.now();
    // Five accounts per minute leave capacity for 6,000 daily accounts after 04:00 JST.
    // Old snapshots come first, so a busy day cannot repeatedly starve later IDs.
    const accounts = await db.prepare(`
      SELECT a.id FROM line_accounts a
      LEFT JOIN customer_activity_runs c ON c.account_id=a.id
      WHERE a.is_active=1 AND a.archived_at IS NULL
        AND NOT (COALESCE(c.status, '')='ready'
          AND COALESCE(substr(datetime(c.computed_at,'+9 hours'),1,10)=?, 0))
        AND NOT (COALESCE(c.status, '')='failed'
          AND COALESCE(julianday(c.last_attempt_at)>julianday(?,'-1 hour'), 0))
      ORDER BY COALESCE(c.last_attempt_at, c.computed_at, ''), COALESCE(c.computed_at, ''), a.id LIMIT ?
    `).bind(japanDate(now), now.toISOString(), CUSTOMER_SEGMENT_BATCH_SIZE)
      .all<{ id: string }>();
    let failure: unknown;
    for (const account of accounts.results) {
      if (Date.now() - started >= SCHEDULED_WORK_BUDGET_MS || !await lease.renew()) break;
      try {
        await refreshCustomerSegments(db, account.id, now);
        const { evaluateRanks } = await import('./member-ranks.js');
        await evaluateRanks(db, account.id, false, now);
      } catch (error) {
        await db.prepare(`INSERT INTO customer_activity_runs(account_id,last_attempt_at,status)
          VALUES(?,?,'failed') ON CONFLICT(account_id) DO UPDATE
          SET last_attempt_at=excluded.last_attempt_at,status='failed'`)
          .bind(account.id, now.toISOString()).run();
        failure = error;
      }
    }
    if (failure) throw failure;
  });
}
