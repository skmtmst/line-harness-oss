import { jstCalendar as japanCalendar } from '@line-crm/shared';
import { parseExecutionDateRange } from '@line-crm/shared';
import { getHqBroadcastRun, readHqBroadcastResult } from '../../services/hq-broadcasts.js';
import { StampError } from '../../services/visit-stamps.js';

const statusSql=`CASE WHEN r.status='cancelled' THEN 'cancelled' WHEN r.status='stopped' THEN 'stopped'
 WHEN r.status='prepared' THEN CASE WHEN json_extract(r.approval_json,'$.status')='pending' THEN 'pending_approval' ELSE 'draft' END
 WHEN EXISTS(SELECT 1 FROM hq_broadcast_targets t JOIN broadcasts b ON b.id=t.broadcast_id WHERE t.run_id=r.id AND t.excluded=0 AND b.status='sending') THEN 'sending'
 WHEN EXISTS(SELECT 1 FROM hq_broadcast_targets t JOIN broadcasts b ON b.id=t.broadcast_id WHERE t.run_id=r.id AND t.excluded=0 AND b.status='scheduled') THEN 'scheduled'
 WHEN EXISTS(SELECT 1 FROM hq_broadcast_targets t JOIN broadcasts b ON b.id=t.broadcast_id WHERE t.run_id=r.id AND t.excluded=0 AND (b.status='draft' OR EXISTS(SELECT 1 FROM broadcast_send_claims s WHERE s.broadcast_id=b.id AND s.state IN ('failed','unknown')))) THEN 'failed'
 WHEN EXISTS(SELECT 1 FROM hq_broadcast_targets t JOIN broadcasts b ON b.id=t.broadcast_id WHERE t.run_id=r.id AND t.excluded=0 AND b.status='sent') THEN 'sent' ELSE 'scheduled' END`;
/** Keep the array response compatible while returning page/count metadata for the HQ list. */
export async function listHqBroadcasts(db:D1Database,tenantId:string,input:Record<string,string|undefined>) {
  let period;
  try {period=parseExecutionDateRange({from:input.from,to:input.to});}catch{throw new StampError('配信日の指定を確認してください',400);}
  const number=(raw:string|undefined,def:number,min:number,max:number)=>{if(raw===undefined)return def;if(!/^\d+$/.test(raw)||!Number.isSafeInteger(Number(raw))||Number(raw)<min||Number(raw)>max)throw new StampError('ページの指定を確認してください',400);return Number(raw)};
  const limit=number(input.limit,100,1,100),offset=number(input.cursor,0,0,1000000);
  if(input.q&&input.q.length>200)throw new StampError('検索は200文字以内にしてください',400);
  const allowed=['draft','pending_approval','scheduled','sending','sent','failed','stopped','cancelled'];
  if(input.status&&!allowed.includes(input.status))throw new StampError('状態を選び直してください',400);
  const conditions=['r.tenant_id=?'],bindings:(string|number)[]=[tenantId];
  // sent_at/scheduled_at carry their zone; HQ's fallback created_at is UTC.
  const at="julianday(COALESCE((SELECT MAX(b.sent_at) FROM hq_broadcast_targets t JOIN broadcasts b ON b.id=t.broadcast_id WHERE t.run_id=r.id AND t.excluded=0),r.scheduled_at,r.created_at))";
  if(period.from){conditions.push(`${at}>=julianday(?)`);bindings.push(period.from);}
  if(period.until){conditions.push(`${at}<julianday(?)`);bindings.push(period.until);}
  if(input.q){conditions.push("(instr(lower(json_extract(r.input_json,'$.title')),lower(?))>0 OR instr(lower(json_extract(r.input_json,'$.messageContent')),lower(?))>0)");bindings.push(input.q,input.q);}
  if(input.folderId){conditions.push(input.folderId==='unfiled'?"COALESCE(json_extract(r.input_json,'$.folderId'),'')=''":"json_extract(r.input_json,'$.folderId')=?");if(input.folderId!=='unfiled')bindings.push(input.folderId);}
  const base=`SELECT r.id,r.created_at,${at} at,${statusSql} display_status FROM hq_broadcast_runs r WHERE ${conditions.join(' AND ')}`;
  const counts=(await db.prepare(`SELECT display_status,COUNT(*) n FROM (${base}) GROUP BY display_status`).bind(...bindings).all<{display_status:string;n:number}>()).results;
  const statusCounts:Record<string,number>={all:0,...Object.fromEntries(allowed.map(s=>[s,0]))};for(const row of counts){statusCounts[row.display_status]=row.n;statusCounts.all+=row.n;}
  const total=input.status?statusCounts[input.status]:statusCounts.all;
  const rows=(await db.prepare(`SELECT id,display_status FROM (${base}) ${input.status?'WHERE display_status=?':''} ORDER BY at ${input.sort==='oldest'?'ASC':'DESC'},id ${input.sort==='oldest'?'ASC':'DESC'} LIMIT ? OFFSET ?`).bind(...bindings,...(input.status?[input.status]:[]),limit,offset).all<{id:string;display_status:string}>()).results;
  const data=[];
  for(const row of rows){const run=await readHqBroadcastResult(db,await getHqBroadcastRun(db,tenantId,row.id));data.push({...run,displayStatus:row.display_status,selectable:true});}
  return {data,pagination:{total,limit,cursor:offset,nextCursor:offset+rows.length<total?String(offset+rows.length):null},statusCounts};
}

/** Cached LINE quotas remain per account; stale or missing accounts make the total unknown. */
export async function hqBroadcastQuota(db:D1Database,tenantId:string) {
  const accounts=(await db.prepare(`SELECT a.id,a.name,(SELECT h.value_json FROM operation_health_results h JOIN operation_health_runs r ON r.id=h.run_id
    WHERE r.line_account_id=a.id AND r.status='completed' AND h.check_key='message_quota' ORDER BY julianday(h.observed_at) DESC,h.id DESC LIMIT 1) value_json,
    (SELECT h.observed_at FROM operation_health_results h JOIN operation_health_runs r ON r.id=h.run_id
    WHERE r.line_account_id=a.id AND r.status='completed' AND h.check_key='message_quota' ORDER BY julianday(h.observed_at) DESC,h.id DESC LIMIT 1) observed_at
    FROM line_accounts a WHERE a.tenant_id=? AND a.is_active=1 AND a.archived_at IS NULL ORDER BY a.id`).bind(tenantId).all<{id:string;name:string;value_json:string|null;observed_at:string|null}>()).results;
  const perAccount=accounts.map(a=>{
    let v:{line?:{remaining?:number;used?:number;limit?:number}}={};try{v=JSON.parse(a.value_json??'{}')??{};}catch{ /* Unreadable measurements are unknown. */ }
    const observed=a.observed_at?Date.parse(a.observed_at):NaN;
    const fresh=Number.isFinite(observed)&&observed<=Date.now()&&Date.now()-observed<=15*60*1000
      &&japanCalendar(new Date(observed)).toISOString().slice(0,7)===japanCalendar().toISOString().slice(0,7);
    const value=(n:unknown)=>fresh&&typeof n==='number'&&Number.isFinite(n)&&n>=0?n:null;
    return {accountId:a.id,accountName:a.name,remaining:value(v.line?.remaining),used:value(v.line?.used),limit:value(v.line?.limit),observedAt:a.observed_at,fresh};
  });
  const sum=(key:'remaining'|'used'|'limit')=>perAccount.length&&perAccount.every(a=>a[key]!==null)?perAccount.reduce((n,a)=>n+a[key]!,0):null;
  return {source:'operation_health_cache',maxAgeSeconds:900,remaining:sum('remaining'),used:sum('used'),limit:sum('limit'),perAccount};
}
