import {addDays,parseExecutionDateRange} from '@line-crm/shared';
import {GapError} from './gap-common.js';

function date(value:string):number {
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new GapError('invalid_period');
 const at=Date.parse(`${value}T00:00:00Z`);
 try {parseExecutionDateRange({from:value});} catch {throw new GapError('invalid_period');}
 if(!Number.isFinite(at))throw new GapError('invalid_period');
 return at;
}
export function inboxResponsePeriod(from:string,to:string) {
 const first=date(from),last=date(to);
 if(last<first || last-first>365*86400000 || new Date(first).getUTCDay()!==1 || new Date(last).getUTCDay()!==0)throw new GapError('invalid_period');
 const start=`${from}T00:00:00+09:00`,end=`${addDays(to,1)}T00:00:00+09:00`;
 return {start,end};
}
/** Ordinary staff may only see their own rows. Deleted conversations retain only weekly counts. */
export async function inboxResponseAnalytics(db:D1Database,account:string,from:string,to:string,ownStaffId:string|null) {
 const {start,end}=inboxResponsePeriod(from,to);
 const filter=`account_id=? AND reply_kind='manual' AND is_first_response=1 AND pending_since IS NOT NULL
  AND julianday(responded_at)>=julianday(?) AND julianday(responded_at)<julianday(?) AND (? IS NULL OR staff_id=?)`;
 const binds=[account,start,end,ownStaffId,ownStaffId];
 const totalMedian=await db.prepare(`WITH ranked AS (
  SELECT (julianday(responded_at)-julianday(pending_since))*1440 AS minutes,
   ROW_NUMBER() OVER(ORDER BY julianday(responded_at)-julianday(pending_since)) AS rn,COUNT(*) OVER() AS total
  FROM inbox_response_samples WHERE ${filter}
 ) SELECT ROUND(AVG(minutes),2) AS median FROM ranked WHERE rn IN ((total+1)/2,(total+2)/2)`)
  .bind(...binds).first<{median:number|null}>();
 const rows=await db.prepare(`WITH ranked AS (
  SELECT staff_id,staff_deleted,pending_since,due_at,responded_at,
   (julianday(responded_at)-julianday(pending_since))*1440 AS minutes,
   ROW_NUMBER() OVER(PARTITION BY staff_id,staff_deleted ORDER BY julianday(responded_at)-julianday(pending_since)) AS rn,
   COUNT(*) OVER(PARTITION BY staff_id,staff_deleted) AS total
  FROM inbox_response_samples WHERE ${filter}
 ) SELECT r.staff_id,r.staff_deleted,CASE WHEN r.staff_deleted=1 THEN '削除された担当者' ELSE COALESCE(m.name,'未割り当て') END AS staff_name,COUNT(*) AS count,
   ROUND(AVG(CASE WHEN r.rn IN ((r.total+1)/2,(r.total+2)/2) THEN r.minutes END),2) AS median,
   SUM(CASE WHEN r.due_at IS NOT NULL THEN 1 ELSE 0 END) AS due_count,
   SUM(CASE WHEN r.due_at IS NOT NULL AND julianday(r.responded_at)<=julianday(r.due_at) THEN 1 ELSE 0 END) AS on_time
  FROM ranked r LEFT JOIN staff_members m ON m.id=r.staff_id GROUP BY r.staff_id,r.staff_deleted,m.name ORDER BY m.name,r.staff_id`)
  .bind(...binds).all<{staff_id:string|null;staff_deleted:number;staff_name:string;count:number;median:number|null;due_count:number;on_time:number}>();
 const weeks=await db.prepare(`SELECT date(responded_at,'+09:00','weekday 0','-6 days') AS week,COUNT(*) AS count
   FROM inbox_response_samples WHERE ${filter} GROUP BY week ORDER BY week`).bind(...binds).all<{week:string;count:number}>();
 const deleted=await db.prepare(`SELECT d.staff_id,d.staff_deleted,CASE WHEN d.staff_deleted=1 THEN '削除された担当者' ELSE COALESCE(m.name,'未割り当て') END AS staff_name,
  SUM(d.on_time) AS on_time,SUM(d.overdue) AS overdue,SUM(d.no_deadline) AS no_deadline
  FROM inbox_response_deleted_weekly d LEFT JOIN staff_members m ON m.id=d.staff_id
  WHERE d.account_id=? AND d.week>=? AND d.week<=? AND (? IS NULL OR d.staff_id=?) GROUP BY d.staff_id,d.staff_deleted,m.name`)
  .bind(account,from,to,ownStaffId,ownStaffId).all<{staff_id:string|null;staff_deleted:number;staff_name:string;on_time:number;overdue:number;no_deadline:number}>();
 const deletedWeeks=await db.prepare(`SELECT week,SUM(on_time+overdue+no_deadline) AS count FROM inbox_response_deleted_weekly
  WHERE account_id=? AND week>=? AND week<=? AND (? IS NULL OR staff_id=?) GROUP BY week`).bind(account,from,to,ownStaffId,ownStaffId).all<{week:string;count:number}>();
 const merged=rows.results.map(r=>({...r,deleted_count:0}));
 for(const d of deleted.results){
  const count=d.on_time+d.overdue+d.no_deadline;
  if(!count)continue;
  let row=merged.find(r=>r.staff_id===d.staff_id && r.staff_deleted===d.staff_deleted);
  if(!row){row={staff_id:d.staff_id,staff_deleted:d.staff_deleted,staff_name:d.staff_name,count:0,median:null,due_count:0,on_time:0,deleted_count:0};merged.push(row);}
  row.count+=count;row.deleted_count+=count;row.due_count+=d.on_time+d.overdue;row.on_time+=d.on_time;
 }
 const weekly=new Map(weeks.results.map(r=>[r.week,r.count]));
 for(const row of deletedWeeks.results)weekly.set(row.week,(weekly.get(row.week)??0)+row.count);

 const deletedAutomatic=ownStaffId===null ? await db.prepare(`SELECT COALESCE(SUM(automatic),0) AS count FROM inbox_response_deleted_weekly WHERE account_id=? AND week>=? AND week<=?`).bind(account,from,to).first<{count:number}>() : null;
 const automatic=ownStaffId===null ? await db.prepare(`SELECT COUNT(*) AS count,SUM(CASE WHEN chat_id IS NULL THEN 1 ELSE 0 END) AS unavailable FROM inbox_response_samples WHERE account_id=? AND reply_kind='automatic'
  AND julianday(responded_at)>=julianday(?) AND julianday(responded_at)<julianday(?)`).bind(account,start,end).first<{count:number;unavailable:number|null}>() : null;
 const due=merged.reduce((sum,row)=>sum+row.due_count,0),onTime=merged.reduce((sum,row)=>sum+row.on_time,0);
 const manualCount=merged.reduce((sum,row)=>sum+row.count,0),automaticCount=automatic ? automatic.count+(deletedAutomatic?.count??0):0;
 return {summary:{medianFirstResponseMinutes:totalMedian?.median??null,withinSlaRate:due?Math.round(onTime*10000/due)/100:null,overdueCount:due-onTime,totalCount:manualCount+automaticCount},byStaff:merged.map(r=>({staffId:r.staff_id,staffDeleted:Boolean(r.staff_deleted),staffName:r.staff_name,medianFirstResponseMinutes:r.median,deletedCount:r.deleted_count,
  withinSlaRate:r.due_count?Math.round(r.on_time*10000/r.due_count)/100:null,count:r.count})),
  automatic:automatic?{count:automatic.count+(deletedAutomatic?.count??0),deletedCount:deletedAutomatic?.count??0,unavailableCount:automatic.unavailable??0}:null,weekly:[...weekly.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([week,count])=>({week,count}))};
}
