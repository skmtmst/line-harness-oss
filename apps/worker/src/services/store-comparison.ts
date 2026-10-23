import type { StoreComparisonDay, StoreComparisonKey } from '@line-crm/shared';
import { jstDateOffset as japanDateOffset } from '@line-crm/shared';
import {GapError} from './gap-common.js';
import { SCHEDULED_WORK_BUDGET_MS, withScheduledWorkLease } from './scheduled-work-lease.js';
export const comparisonKeys=['friendChange','blockRate','clickRate','bookings','visits','noShowRate','responseMinutes']as const;
export type ComparisonKey=typeof comparisonKeys[number];
export const comparisonUnits:Record<ComparisonKey,string>={friendChange:'人',blockRate:'%',clickRate:'%',bookings:'件',visits:'件',noShowRate:'%',responseMinutes:'分'};
export async function snapshotStoreMetrics(db:D1Database,a:string,day:string,now=new Date()){
 const from=new Date(`${day}T00:00:00+09:00`).toISOString(),to=new Date(Date.parse(from)+86400000).toISOString();
 const style=await db.prepare("SELECT style FROM account_styles WHERE line_account_id=? AND selection_mode='configured'").bind(a).first<{style:string}>();
 const bookingEnabled=style?.style!=='ec'&&!!await db.prepare('SELECT id FROM booking_settings WHERE line_account_id=?').bind(a).first();
 const count=await db.prepare(`SELECT count(CASE WHEN b.status NOT IN('cancelled','rejected','expired') THEN 1 END) bookings,count(CASE WHEN (SELECT kind FROM booking_visit_marks v WHERE v.booking_id=b.id ORDER BY julianday(v.marked_at) DESC,v.id DESC LIMIT 1)='visited' THEN 1 END) visits,count(CASE WHEN b.status='no_show' OR (SELECT kind FROM booking_visit_marks v WHERE v.booking_id=b.id ORDER BY julianday(v.marked_at) DESC,v.id DESC LIMIT 1)='no_show' THEN 1 END) no_shows FROM bookings b WHERE b.line_account_id=? AND julianday(b.starts_at)>=julianday(?) AND julianday(b.starts_at)<julianday(?)`).bind(a,from,to).first<{bookings:number;visits:number;no_shows:number}>();
 // Lifetime friend state cannot reconstruct past block events. Leave those fields unknown.
 await db.prepare(`INSERT OR IGNORE INTO hq_store_response_samples(account_id,chat_id,pending_since,responded_at,minutes) SELECT ?,c.id,c.pending_since,c.first_response_at,(julianday(c.first_response_at)-julianday(c.pending_since))*1440 FROM chats c JOIN friends f ON f.id=c.friend_id WHERE f.line_account_id=? AND c.first_response_at IS NOT NULL AND c.pending_since IS NOT NULL AND julianday(c.first_response_at)>=julianday(c.pending_since) AND julianday(c.first_response_at)>=julianday(?) AND julianday(c.first_response_at)<julianday(?)`).bind(a,a,from,to).run();
 const response=(await db.prepare('SELECT minutes FROM hq_store_response_samples WHERE account_id=? AND julianday(responded_at)>=julianday(?) AND julianday(responded_at)<julianday(?) ORDER BY minutes').bind(a,from,to).all<{minutes:number}>()).results.map(r=>r.minutes);
 const median=response.length?(response[Math.floor((response.length-1)/2)]+response[Math.floor(response.length/2)])/2:null;
 await db.prepare(`INSERT INTO hq_store_daily_metrics(account_id,date,bookings,visits,no_shows,first_response_median_minutes,first_response_count,state,computed_at) VALUES(?,?,?,?,?,?,?,'partial',?) ON CONFLICT(account_id,date) DO UPDATE SET bookings=excluded.bookings,visits=excluded.visits,no_shows=excluded.no_shows,first_response_median_minutes=excluded.first_response_median_minutes,first_response_count=excluded.first_response_count,state='partial',computed_at=excluded.computed_at`).bind(a,day,bookingEnabled?count?.bookings??0:null,bookingEnabled?count?.visits??0:null,bookingEnabled?count?.no_shows??0:null,median,response.length,now.toISOString()).run();
}
export function comparisonPeriod(from?:string,to?:string){
 const end=to??japanDateOffset(-1),start=from??new Date(Date.parse(end)-29*86400000).toISOString().slice(0,10);
 if(![start,end].every(s=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s)||start>end||Date.parse(end)-Date.parse(start)>366*86400000)throw new GapError('invalid_period');return {from:start,to:end,days:1+(Date.parse(end)-Date.parse(start))/86400000};
}
/** Daily values use only the saved observation, never fill a missing day with zero. */
export function comparisonTrend(rows:Record<string,unknown>[], period:ReturnType<typeof comparisonPeriod>):StoreComparisonDay[] {
 const byDay=new Map(rows.map(row=>[String(row.date),row]));
 return Array.from({length:period.days},(_,index)=>{
  const date=japanDateOffset(index,new Date(`${period.from}T00:00:00+09:00`)),row=byDay.get(date);
  const value=(key:string)=>typeof row?.[key]==='number'&&Number.isFinite(row[key])?row[key] as number:null;
  const added=value('friends_added'),blocked=value('friends_blocked'),start=value('friends_at_start'),recipients=value('broadcast_recipients'),clicks=value('broadcast_clicks'),visits=value('visits'),noShows=value('no_shows');
  const known=!!row&&row.state!=='failed';
  const values:Record<StoreComparisonKey,number|null>={friendChange:added!==null&&blocked!==null?added-blocked:null,blockRate:start!==null&&start>0&&blocked!==null?100*blocked/start:null,clickRate:recipients!==null&&recipients>0&&clicks!==null?100*clicks/recipients:null,bookings:value('bookings'),visits,noShowRate:visits!==null&&noShows!==null&&visits+noShows>0?100*noShows/(visits+noShows):null,responseMinutes:value('first_response_median_minutes')};
  if(!known)for(const key of comparisonKeys)values[key]=null;
  return {date,values,state:row?.state==='failed'?'failed':!row?'missing':row.state==='ready'?'ready':'partial'};
 });
}
export async function storeNumbers(db:D1Database,a:string,period:ReturnType<typeof comparisonPeriod>){
 const style=(await db.prepare("SELECT style FROM account_styles WHERE line_account_id=? AND selection_mode='configured'").bind(a).first<{style:string}>())?.style??null;
 const observations=(await db.prepare("SELECT * FROM hq_store_daily_metrics WHERE account_id=? AND date BETWEEN ? AND ? ORDER BY date").bind(a,period.from,period.to).all<Record<string,unknown>>()).results;
 const rows=observations.filter(row=>row.state!=='failed');
 const full=rows.length===period.days,sum=(key:string)=>full&&rows.every(r=>r[key]!==null)?rows.reduce((n,r)=>n+Number(r[key]),0):null;
 const added=sum('friends_added'),blocked=sum('friends_blocked'),start=full?rows[0]?.friends_at_start:null,recipients=sum('broadcast_recipients'),clicks=sum('broadcast_clicks'),visits=sum('visits'),noShows=sum('no_shows');
 // Read human response timestamps to compute the actual period median, never a median of medians.
 const from=new Date(`${period.from}T00:00:00+09:00`).toISOString(),to=new Date(Date.parse(`${period.to}T00:00:00+09:00`)+86400000).toISOString();
 const minutes=full?(await db.prepare(`SELECT minutes FROM hq_store_response_samples WHERE account_id=? AND julianday(responded_at)>=julianday(?) AND julianday(responded_at)<julianday(?) ORDER BY minutes`).bind(a,from,to).all<{minutes:number}>()).results.filter(x=>x.minutes>=0).map(x=>x.minutes):[];
 const response=minutes.length?(minutes[Math.floor((minutes.length-1)/2)]+minutes[Math.floor(minutes.length/2)])/2:null;
 const values:Record<ComparisonKey,number|null>={friendChange:added!==null&&blocked!==null?added-blocked:null,blockRate:start&&blocked!==null?100*blocked/Number(start):null,clickRate:recipients&&clicks!==null?100*clicks/recipients:null,bookings:sum('bookings'),visits,noShowRate:visits!==null&&noShows!==null&&visits+noShows>0?100*noShows/(visits+noShows):null,responseMinutes:response};
 return {values,style,computedAt:full?rows.map(r=>String(r.computed_at)).sort()[0]??null:null,trend:observations};
}

export const STORE_COMPARISON_DAILY_BATCH_SIZE = 5;
const STORE_COMPARISON_ATTEMPT_PREFIX = 'store-comparison:attempt:';

/** Keep a repair slot as well as enough daily slots for 5,000 accounts. */
export async function processStoreComparison(db: D1Database, now = new Date()) {
  return withScheduledWorkLease(db, 'store-comparison', async (lease) => {
    const yesterday = japanDateOffset(-1, now);
    const started = Date.now();
    let failure: unknown;
    for (const historical of [true, false]) {
      const attemptPrefix = STORE_COMPARISON_ATTEMPT_PREFIX + (historical ? 'history:' : 'daily:');
      const accounts = historical
        ? await db.prepare(`WITH RECURSIVE
            eligible_accounts AS MATERIALIZED (
              SELECT a.id, CASE WHEN upper(substr(a.created_at,-1))='Z' OR substr(a.created_at,-6,1) IN('+','-')
                THEN date(a.created_at,'+9 hours') ELSE MIN(date(a.created_at),date(a.created_at,'+9 hours')) END first_day,
                (SELECT MIN(m.date) FROM hq_store_daily_metrics m WHERE m.account_id=a.id) first_metric_day,
                attempt.value last_attempt_at
              FROM line_accounts a
              LEFT JOIN platform_settings attempt ON attempt.key=?||a.id
              WHERE a.is_active=1 AND a.archived_at IS NULL
                AND (CASE WHEN upper(substr(a.created_at,-1))='Z' OR substr(a.created_at,-6,1) IN('+','-')
                  THEN date(a.created_at,'+9 hours') ELSE MIN(date(a.created_at),date(a.created_at,'+9 hours')) END < ?
                  OR EXISTS(SELECT 1 FROM hq_store_daily_metrics m WHERE m.account_id=a.id AND m.date<?))
            ), days(day) AS (
              SELECT date(?,'-1 day') UNION ALL SELECT date(day,'-1 day') FROM days WHERE day>date(?,'-366 days')
            ) SELECT a.id,days.day FROM days CROSS JOIN eligible_accounts a
            WHERE (days.day>=a.first_day OR days.day>=a.first_metric_day)
              AND NOT EXISTS(SELECT 1 FROM hq_store_daily_metrics m WHERE m.account_id=a.id AND m.date=days.day
                AND (m.state!='failed' OR julianday(m.computed_at)>julianday(?,'-1 hour')))
            ORDER BY COALESCE(a.last_attempt_at, ''), days.day ASC,a.id LIMIT 1`)
            .bind(attemptPrefix, yesterday, yesterday, yesterday, yesterday, now.toISOString())
            .all<{ id: string; day: string }>()
        : await db.prepare(`SELECT a.id, ? AS day FROM line_accounts a
            LEFT JOIN platform_settings attempt ON attempt.key=?||a.id
            WHERE a.is_active=1 AND a.archived_at IS NULL
              AND NOT EXISTS(SELECT 1 FROM hq_store_daily_metrics m WHERE m.account_id=a.id AND m.date=?
                AND (m.state!='failed' OR julianday(m.computed_at)>julianday(?,'-1 hour')))
            ORDER BY COALESCE(attempt.value, ''), COALESCE((SELECT MAX(m.date) FROM hq_store_daily_metrics m
              WHERE m.account_id=a.id AND m.state!='failed'), ''), a.id LIMIT ?`)
            .bind(yesterday, attemptPrefix, yesterday, now.toISOString(), STORE_COMPARISON_DAILY_BATCH_SIZE)
            .all<{ id: string; day: string }>();
      for (const account of accounts.results) {
        if (Date.now() - started >= SCHEDULED_WORK_BUDGET_MS || !await lease.renew()) break;
        try {
          // Separate daily/history cursors avoid a successful daily refresh moving
          // untouched history behind a repeatedly failing repair prefix.
          await db.prepare(`INSERT INTO platform_settings(key,value,updated_by,updated_at)
            VALUES(?,?,'store-comparison',?) ON CONFLICT(key) DO UPDATE
            SET value=excluded.value,updated_at=excluded.updated_at`)
            .bind(attemptPrefix + account.id, now.toISOString(), now.toISOString()).run();
          await snapshotStoreMetrics(db, account.id, account.day, now);
        } catch (error) {
          await db.prepare(`INSERT INTO hq_store_daily_metrics(account_id,date,state,computed_at)
            VALUES(?,?,'failed',?) ON CONFLICT(account_id,date) DO UPDATE
            SET state='failed',computed_at=excluded.computed_at`)
            .bind(account.id, account.day, now.toISOString()).run();
          failure = error;
        }
      }
    }
    if (failure) throw failure;
  });
}
